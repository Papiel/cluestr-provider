# Cluestr file provider

NodeJS toolkit for creating [Cluestr](http://cluestr.com) providers.

## Introduction

If you want to add a new service to Cluestr (as a document entry point), you should use this tiny toolkit.

This toolkit enables you to bridge a given service to the cluestr api by mounting a server receiving calls from both side (ie. the service and Cluestr).

## Installation

`npm install cluestr-provider`

Then:

```javascript
// See syntax below
var server = CluestrProvider.createServer(configHash);
```

## Configuration hash
You need to specify some handlers and datas in the `configHash`.

### Datas
```javascript
configHash = {
  cluestrAppId: 'appId',
  cluestrAppSecret: 'appSecret',
  connectUrl: 'http://myprovider.example.org/init/connect'
  ...
};
```

* `cluestrAppId`: application id from Cluestr.
* `cluestrAppSecret`: application secret from Cluestr.
* `connectUrl`: redirect_uri registered on Cluestr.

### Handlers

```javascript
configHash = {
   ...
  initAccount: initAccount,
  connectAccountRetrievePreDatas: connectAccountRetrievePreDatas,
  connectAccountRetrieveAuthDatas: connectAccountRetrieveAuthDatas,
  updateAccount: updateAccount,
  queueWorker: queueWorker,
};
```

#### `initAccount`
Called when connecting an account for the first time.
This function is responsible to store pre-datas (authorization grant, temporary values) and redirecting to another page.

Params:
* `req`: the current request
* `next`: call this after filling `res`. First parameter is the error (if you want to abort), second parameter is the datas to store, third parameter the page where the user should be redirected

Example:
```javascript
var initAccount = function(req, res, next) {
  var preDatas = {
    accessGrant: accessGrant
  };

  var redirectUrl = "http://myprovider.example.org/authorize";
  next(null, preDatas, redirectUrl);
};
```

#### `connectAccountRetrievePreDatasIdentifier`
This function should return an object hash uniquely identifying the preDatas previously sent.
To build this hash, you can use `req` containing all datas about the current request (and possibly a callback code, the previous grant, ... depending on your OAuth provider).

> Please note : for now, you need to prefix each of your key with `data.`. This will probably be modified in the future.
> For instance `{'datas.accessGrant': req.params.code}`.

Params:
* `req`: the current request. Access GET values in `req.params`.
* `next`: call this with the error if any (your provider did not return a code, ...) and your identifier hash.

Example:
```javascript
var connectAccountRetrievePreDatasIdentifier = function(req, next) {
  next({'datas.accessGrant': accessGrant}, next);
};
```

#### `connectAccountRetrieveAuthDatas`
This function will be called to retrieve a set of datas to store permanently.
Store your tokens (refresh tokens, access tokens) or any other informations.

Params:
* `req`: the current request. Access GET values in `req.params`.
* `preDatas` datas stored previously, as returned by `initAccount`
* `next`: call this with the error if any (token is invalid, preDatas are out of date, ...) and the datas to store permanently. Third parameter can optionally be the redirect page, if blank it will be `cluestr.com`.

Example:
```javascript
var connectAccountRetrieveAuthDatas = function(req, preDatas, next) {
  var datas = {
    refreshToken: retrieveRefreshToken()
  }
  next(null, datas);
};
```

#### `updateAccount`
This function will be called periodically to update documents. Calls will occur:
* when the user ping `/update` on Cluestr API
* right after connecting the provider for the first time
* after a span of time, when Cluestr server deems new datas can be gathered.

This function must return a list of task, each task being a document to create or update on Cluestr.
This tasks will be fed to `queueWorker` (see below).
The function must also return a cursor (for instance, the current date) to remember the state and start upload from this point next time.

Params:
* `datas`: datas stored by `connectAccountRetrieveAuthDatas`
* `cursor`: last cursor, or null on first run.
* `next`: call this with the error if any (grant has been revoked, ...), the list of tasks to feed to `queueWorker` and the new cursor (it will be written after all tasks are processed).

```javascript
var updateAccount = function(datas, cursor, next) {
  // Update the account !
  var tasks = [
    { 'url': 'http://...', 'token': '...'},
    { 'url': 'http://...', 'token': '...'}
  ];

  next(null, tasks, new Date());
};
```

#### `queueWorker`
This function will be called with each task returned by `updateAccount`.
It must send the document to Cluestr using the client available on `cluestrClient`.

Params:
* `task` the task defined previously.
* `cluestrClient` pre-configured client for upload (with appId, appSecret and accessToken)
* `datas` datas for the account being updated
* `cb` call this once document is uploaded and you're ready for another task

```javascript
var queueWorker = function(task, cluestrClient, datas, cb) {
  // Upload document
  cluestrClient.sendDocument(task, cb);
};
```

### Optional parameters

* `concurrency` : number of tasks to run simultaneously on `queueWorker`, default is 1.
* `redirectUrl` : url where the user should be redirected after `connectAccountRetrieveAuthDatas` (on /init/callback)

## Register additional endpoints
Sometimes, you'll need to define additional endpoints -- for example to receive push notifications from your provider.
To do so, you can simply plug new routes onto the `server` object. Behind the scenes, it is a simple customised `restify` server.

For instance:
```javascript
var server = CluestrProvider.createServer(configHash);
server.post('/delta', function(req, res, next) {
  CluestrProvider.retrieveDatas({'datas.account_id': req.params.account_id}, function(err, datas) {
    ...
});
})
```

## Helper functions
### `retrieveDatas(hash, function(err, datas))`
Retrieve datas associated with the `hash`. `hash` must be a unique identifier in all account.
You'll need to prefix the key with `datas.` to search in your datas.

### `debug.createTestFrontServer()`
Create a mock server for your test, to trade authorization grants.
Will always return an `access_token` with value `fake_access_token`.
Use with `process.env.CLUESTR_FRONT`, for instance:

```javascript
var ProviderServer = require('cluestr-provider');
process.env.CLUESTR_FRONT = 'http://localhost:1337';

// Create a fake HTTP server
var frontServer = ProviderServer.debug.createTestFrontServer();
frontServer.listen(1337);
```

You can enable debug mode by specifying `true` as first parameter.

### `debug.createTestApiServer`
Create a mock server for your test, to upload documents and file.
Will provide `/providers/document` (post and delete) and `/providers/document/file`.
Use with `process.env.CLUESTR_SERVER`, for instance:

```javascript
var ProviderServer = require('cluestr-provider');
process.env.CLUESTR_SERVER = 'http://localhost:1338';

// Create a fake HTTP server
var frontServer = ProviderServer.debug.createTestApiServer();
frontServer.listen(1338);
```

You can enable debug mode by specifying `true` as first parameter.

### `debug.createToken`
Create a Token Mongoose model.

### `debug.createTempToken`
Create TempToken Mongoose model.
