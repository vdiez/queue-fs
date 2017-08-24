let Client = require('ssh2').Client;
let fs = require('fs-extra');
let path = require('path');

function SCP(params) {
    let self = this;
    self.client = undefined;
    self.sftp = undefined;
    self.writeStream = undefined;
    self.queue = undefined;

    self.params = {};
    self.params.host = params.host;
    self.params.readyTimeout = 60000;
    if (params.port) self.params.port = params.port;
    if (params.username) self.params.username = params.username;
    if (params.password) self.params.password = params.password;
}

SCP.prototype.open_connection = function() {
    let self = this;
    if (self.is_connected()) return Promise.resolve();

    console.log("Opening SCP connection");
    return new Promise(function(resolve, reject) {
        self.client = new Client();
        self.client
            .on('ready', function () {
                self.client.sftp(function (err, sftp) {
                    if (err) reject(err);
                    else {
                        self.sftp = sftp;
                        resolve();
                    }
                });
            })
            .on('error', function (err) {
                self.client = undefined;
                self.sftp = undefined;
                reject(err);
            })
            .on('end', function () {
                self.client = undefined;
                self.sftp = undefined;
                reject("Connection ended");
            })
            .on('close', function (err) {
                self.client = undefined;
                self.sftp = undefined;
                reject("Connection closed: " + err);
            })
            .connect(self.params);
    });
};

SCP.prototype.stop = function() {
    let self = this;
    if (self.writeStream) self.writeStream.close();
};

SCP.prototype.create_path = function (sftp, rel_path, cb) {
    let self = this;
    if (!rel_path || rel_path == "/" || rel_path == ".") {
        cb();
        return;
    }
    sftp.stat(rel_path, function (err1, stats) {
        if (err1) {
            sftp.mkdir(rel_path, function (err2) {
                if (err2) {
                    console.log("Error[%s] %s creating path: %s", err2.code, err2, rel_path);
                    if (err2.code == 2) { // NO_SUCH_FILE
                        self.create_path(sftp, path.dirname(rel_path), function () {
                            self.create_path(sftp, rel_path, cb);
                        });
                    }
                    else cb(err2);
                }
                else {
                    console.log("Created path: %s", rel_path);
                    cb();
                }
            });
        }
        else cb();
    });
};

SCP.prototype.transfer_file = function (src, dst, progress) {
    let self = this;

    return new Promise(function(resolve, reject) {
        self.queue = Promise.resolve(self.queue)
            .then(function() {
                return self.open_connection()
                    .then(function() {
                        return new Promise(function(resolve2, reject2) {
                            fs.stat(src, function (err, stats) {
                                if (err) {
                                    resolve("Stat failed. Skipping transfer of: " + src);
                                    resolve2();
                                }
                                else {
                                    self.sftp.stat(dst, function (err, stats2) {
                                        if (!err && stats2.size == stats.size) {
                                            resolve("File already exists. Skipping transfer of: " + src);
                                            resolve2();
                                        }
                                        else {
                                            self.create_path(self.sftp, path.dirname(dst), function (err) {
                                                if (err) {
                                                    reject(err);
                                                    resolve2();
                                                }
                                                else {
                                                    let tmp = path.join(path.dirname(dst), "." + path.basename(dst));
                                                    self.writeStream = self.sftp.createWriteStream(tmp);
                                                    self.writeStream.on('error', function (err) {
                                                        reject(err);
                                                        resolve2();
                                                    });
                                                    self.writeStream.on('close', function () {
                                                        self.sftp.rename(tmp, dst, function(err) {
                                                            if (err) reject(err);
                                                            else resolve("Finished transfer of: " + src);
                                                            resolve2();
                                                        });
                                                    });
                                                    let readStream = fs.createReadStream(src);
                                                    let transferred = 0;
                                                    let percentage = 0;
                                                    readStream.on('data', function(buffer) {
                                                        transferred += buffer.length;

                                                        let tmp = Math.round(transferred * 100 / stats.size);
                                                        if (percentage != tmp) {
                                                            percentage = tmp;
                                                            if (progress) progress({current: transferred, size: stats.size, percentage: percentage});
                                                        }
                                                    });
                                                    readStream.pipe(self.writeStream);
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        });
                    })
                    .catch((err) => {console.log("Error: "  + err); reject();});
            });
    });
};

SCP.prototype.close_connection = function () {
    let self = this;
    if (self.client) self.client.end();
    self.client = undefined;
    self.sftp = undefined;
};

SCP.prototype.is_connected = function () {
    let self = this;
    return self.sftp;
};

let workers = {};

module.exports = function(params) {
    let {box, box_idx, route, route_idx, server, transfer, config} = params;
    if (server.protocol !== 'scp') throw "Server protocol does not match module. It should be scp";
    let target = sprintf(server.file, transfer);
    let source = transfer.source;

    let destination = {host: server.ip, username: server.scp.user, password: server.scp.pass, port: server.scp.port};

    let destination_key = JSON.stringify(destination);
    if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new SCP(destination);

    return workers[destination_key].transfer_file(source, target);
};