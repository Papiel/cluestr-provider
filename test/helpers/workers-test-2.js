'use strict';

require('should');

module.exports.test = function testWorker(job, cb) {
  try {
    job.task.should.have.property('a', 2);
    job.serviceData.should.have.property('foo', 'bar');
  }
  catch(e) {
    return cb(e);
  }

  cb();
};
