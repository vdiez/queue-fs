let Client = require('smb2');
let fs = require('fs-extra');
let path = require('path');
let winston = require('winston');
let sprintf = require('sprintf-js').sprintf;

function SMB(params) {
    let self = this;
    self.client = undefined;
    self.readStream = undefined;
    self.queue = undefined;

    self.params = {};
    self.params.share = "\\\\" + params.host + "\\" + params.share;
    self.params.username = params.username;
    self.params.password = params.password;
    self.params.domain = params.domain;
    self.params.autoCloseTimeout = 0;
    if (params.port) self.params.port = params.port;
}

SMB.prototype.open_connection = function(){
    let self = this;
    if (self.is_connected()) return Promise.resolve();

    winston.debug("Opening SMB connection to " + self.params.host);
    self.client = new Client(self.params);

    return new Promise(function(resolve, reject) {
        self.client.connect(function (err) {
            if (err) {
                winston.error("Error on SMB connection " + self.params.share + ": " + err);
                self.client = undefined;
                reject(err);
            }
            else {
                winston.debug("SMB connection to " + self.params.share + " established.");
                resolve();
            }
        });
    });
};

SMB.prototype.stop = function() {
    let self = this;
    if (self.readStream) self.readStream.close();
};

SMB.prototype.transfer_file = function (src, dst, progress) {
    let self = this;

    return new Promise(function(resolve, reject) {
        self.queue = Promise.resolve(self.queue)
            .then(function() {
                return self.open_connection()
                    .then(function() {
                        if (dst.startsWith('/')) dst = dst.slice(1);
                        return new Promise(function(resolve2, reject2) {
                            fs.stat(src, function (err, stats) {
                                if (err) {
                                    reject({exists: false});
                                    resolve2();
                                }
                                else {
                                    self.client.getSize(dst.replace(/\//g, "\\"), function (err, size) {
                                        if (!err && size == stats.size) {
                                            resolve();
                                            resolve2();
                                        }
                                        else {
                                            let path_creation = undefined;
                                            let root_path = path.posix.join(path.dirname(dst), ".tmp");
                                            if (root_path != "." && root_path != "/") {
                                                path_creation = new Promise(function(resolve3, reject3) {
                                                    self.client.ensureDir(root_path.replace(/\//g, "\\"), function (err) {
                                                        if (err) reject3(err);
                                                        else resolve3();
                                                    });
                                                });
                                            }

                                            Promise.resolve(path_creation)
                                                .then(() => {
                                                    let tmp = path.posix.join(path.dirname(dst), ".tmp", path.basename(dst));
                                                    self.client.createWriteStream(tmp.replace(/\//g, "\\"), function (err, writeStream) {
                                                        if (err) {
                                                            reject(err);
                                                            resolve2();
                                                        }
                                                        else {
                                                            self.readStream = fs.createReadStream(src);
                                                            writeStream.on('finish', function () {
                                                                self.readStream = undefined;
                                                                self.client.rename(tmp.replace(/\//g, "\\"), dst.replace(/\//g, "\\"), function(err) {
                                                                    if (err) reject(err);
                                                                    else resolve();
                                                                    resolve2();
                                                                });
                                                            });
                                                            writeStream.on('error', function (err) {
                                                                reject(err);
                                                                resolve2();
                                                            });
                                                            self.readStream.pipe(writeStream);
                                                            if (progress) {
                                                                let transferred = 0;
                                                                let percentage = 0;
                                                                self.readStream.on('data', function (buffer) {
                                                                    transferred += buffer.length;

                                                                    let tmp = Math.round(transferred * 100 / stats.size);
                                                                    if (percentage != tmp) {
                                                                        percentage = tmp;
                                                                        progress({
                                                                            current: transferred,
                                                                            size: stats.size,
                                                                            percentage: percentage
                                                                        });
                                                                    }
                                                                });
                                                            }
                                                        }
                                                    });
                                                })
                                                .catch(() => {reject(err); resolve2();});
                                        }
                                    });
                                }
                            });
                        })
                    })
                    .catch((err) => {reject(err);});
            });
    });
};

SMB.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.close();
    self.client = undefined;
};

SMB.prototype.is_connected = function () {
    let self = this;
    return !!self.client;
};

let workers = {};
let wamp = require('simple_wamp');

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('smb')) {
        actions.smb = function(file, params) {
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let destination = {host: params.host, domain: params.domain, share: params.share, username: params.username, password: params.password, port: params.port};
            let destination_key = JSON.stringify(destination);
            if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new SMB(destination);

            let progress = undefined;
            let wamp_router = params.wamp_router || config.default_router;
            let wamp_realm = params.wamp_realm || config.default_realm;
            if (params.progress && wamp_router && wamp_realm) {
                progress = progress => wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [file, progress]])
            }

            return workers[destination_key].transfer_file(source, target, progress);
        };
    }
    return actions;
};