var debug = require('debug')('strong-pm:action');
var ipcctl = require('../ipcctl');
var path = require('path');
var util = require('util');
var uuid = require('uuid');

module.exports = function(Action) {
  Action.beforeCreate = function beforeCreate(next) {
    var app = Action.app;
    var now = Date.now();
    var req = this.request;
    var self = this;

    debug('enter before create: %j', self);

    this.timestamp = now;
    this.result = {};
    this.id = uuid.v4();

    function doProfile(err, profile, cmd) {
      if (err) return next(err);
      util._extend(self.result, profile);

      fileName = path.resolve('profile.' + profile.profileId + '.' + cmd);
      var req = {
        cmd: 'current',
        sub: self.request.sub,
        target: self.request.target,
        filePath: fileName
      };

      function complete(res) {
        endProfile(app, profile.profileId, fileName, res);
      }

      app._ctlRequestListener(req, complete);
      setImmediate(next);
    }

    switch (this.request.sub) {
      case 'stop-cpu-profiling':
        return beginProfile(app, now, req.target, 'cpuprofile', doProfile);
      case 'heap-snapshot':
        return beginProfile(app, now, req.target, 'heapsnapshot', doProfile);
      default: {
        app._ctlRequestListener(this.request, function(res) {
          self.result = res;
          next();
        });
        return;
      }
    }
  }
}

function endProfile(app, profileId, fileName, res) {
  var ProfileData = app.models.ProfileData;
  var update = {
    id: profileId
  };

  if (res.error) {
    update.errored = res.error;
  } else {
    update.completed = true;
    update.fileName = fileName;
  }

  ProfileData.upsert(update, function(err, profile) {
    debug('end profile after create: %j', err || profile);
    if (err) {
      console.error('Unrecoverable error upserting %j', update);
      throw err;
    }
  });
}

function beginProfile(app, now, target, type, callback) {
  var ProfileData = app.models.ProfileData;
  var Instance = app.models.ServiceInstance;
  var pmServer = app.pmServer;

  if (target == null) {
    return callback(Error('Missing required argument: `target`'));
  }

  var profile = ProfileData({
    executorId: pmServer.executorId,
    serviceId: pmServer.serviceId,
    serviceInstanceId: pmServer.instanceId,
    targetId: target,
    type: type,
    startTime: now
  });

  profile.save(function(err, profile) {
    if (err) return callback(err);

    var pathname = [
      app.get('restApiRoot'),
      Instance.sharedClass.http.path,
      pmServer.serviceId,
      ProfileData.sharedClass.http.path,
      String(profile.id),
      'download'
    ].join('/').replace(/\/+/g, '/'); // Compress // to /

      debug('begin profile: %j', profile, pathname);

      callback(null, {
        profileId: profile.id,
        url: pathname,
      }, type);
  });
}