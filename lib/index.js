'use strict';

var AnyFetchClient = require("anyfetch");
var restify = require('restify');
var async = require('async');
var mongoose = require('mongoose');
var domain = require('domain');

var Token = require('./models/token.js');
var TempToken = require('./models/temp-token.js');

var connected = false;
var connectMongo = function() {
  if(!connected) {
    // Connect mongoose
    mongoose.connect(process.env.MONGO_URL || "mongodb://localhost/anyfetch-provider");
    connected = true;
  }
};


/**
 * Check the specified config contains all mandatory keys.
 */
module.exports.validateConfig = function(config) {
  var mandatoryKeys = ['initAccount', 'connectAccountRetrievePreDataIdentifier', 'connectAccountRetrieveAuthData', 'updateAccount', 'queueWorker', 'anyfetchAppId', 'anyfetchAppSecret', 'connectUrl'];

  for(var i = 0; i < mandatoryKeys.length; i += 1) {
    var mandatoryKey = mandatoryKeys[i];
    if(!config[mandatoryKey]) {
      return new Error("Specify `" + mandatoryKey + "` to create server.");
    }
  }
};

/**
 * Simple wrapper around the token model.
 * Only one token should match.
 *
 * retrieveData({accessToken: ...}) => data for this access token
 * retrieveData({'data.grant': ...}) => data with this value of grant.
 */
module.exports.retrieveData = function(hash, cb) {
  Token.findOne(hash, function(err, token) {
    if(!token) {
      return cb(new Error("no data matches"));
    }
    cb(err, token.data);
  });
};


/**
 * Create a new provider server.
 * This server will use `config.task_generator` as its main function, to turn a file into metadata.
 *
 * @param {Object} config Configuration hash.
 *   Mandatory:
*       task_generator, to retrieve a list of tasks (a task is "a document to upload").
*       task_handler, the uploading function.
*    Optional:
*       concurrency, max number of simultaneous calls to your task_handler function (default is 1)
 */
module.exports.createServer = function(config) {
  var err = module.exports.validateConfig(config);
  if(err) {
    throw err;
  }

  // Connect mongo
  connectMongo();

  // Build anyfetchClient to use everywhere for this server.
  var anyfetchClient = new AnyFetchClient(config.anyfetchAppId, config.anyfetchAppSecret);

  // Load endpoints generators
  var indexEndpoint = require('./handlers/index.js');
  var initEndpoints = require('./handlers/init.js');
  var updateEndpoint = require('./handlers/update.js');
  var statusEndpoint = require('./handlers/status.js');
  var resetEndpoint = require('./handlers/reset.js');

  // Create server
  var server = restify.createServer();
  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.queryParser());
  server.use(restify.bodyParser());

  // Add a queue onto the server
  var queue = function(task, cb) {
    // Check for special finalization task (token update)
    if(task._update) {
      if(task.cursor) {
        task.token.cursor = task.cursor;
        task.token.markModified('cursor');
      }

      task.token.isUpdating = false;
      task.token.markModified('isUpdating');
      return task.token.save(cb);
    }

    // Standard tasks
    // Run in domain to avoid failures
    var d = domain.create();
    d.once('error', cb);
    d.run(function() {
      var anyfetchClient = task.anyfetchClient;
      var tokenData = task.tokenData;
      delete task.anyfetchClient;
      delete task.tokenData;
      config.queueWorker(task, anyfetchClient, tokenData, cb);
    });
  };
  server.queue = async.queue(queue, config.concurrency || 1);


  // Load routes and generate endpoints using closures
  server.get('/', indexEndpoint);
  server.get('/init/connect', initEndpoints.connect(config.initAccount));
  server.get('/init/callback', initEndpoints.callback(config.connectAccountRetrievePreDataIdentifier, config.connectAccountRetrieveAuthData, anyfetchClient, config.connectUrl, config.redirectUrl || 'http://manager.anyfetch.com'));

  server.post('/update', updateEndpoint(config.updateAccount, config.appId, config.appSecret, server.queue));

  server.get('/status', statusEndpoint);
  server.del('/reset', resetEndpoint);

  // Expose the server
  return server;
};


module.exports.debug = {
  createTestFrontServer: AnyFetchClient.debug.createTestFrontServer,
  createTestApiServer: AnyFetchClient.debug.createTestApiServer,
  cleanTokens: function(cb) {
    connectMongo();
    async.parallel([
      function(cb) {
        Token.remove({}, cb);
      },
      function(cb) {
        TempToken.remove({}, cb);
      }
    ], cb);
  },
  createToken: function(hash, cb) {
    connectMongo();

    var token = new Token(hash);
    token.save(cb);
  },
  createTempToken: function(hash, cb) {
    connectMongo();

    var tempToken = new TempToken(hash);
    tempToken.save(cb);
  }
};