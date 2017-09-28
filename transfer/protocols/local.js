let fs = require('fs-extra');

function LOCAL(params) {
    let self = this;
    self.action = params.action;
    self.queue = undefined;
}

LOCAL.prototype.transfer_file = function (src, dst, progress) {
    let self = this;
    return new Promise(function(resolve, reject) {
        self.queue = Promise.resolve(self.queue)
            .then(function() {
                return new Promise(function(resolve2, reject2) {
                    fs.stat(src, function (err, stats) {
                        if (err) {
                            reject({exists: false});
                            resolve2();
                        }
                        else {
                            fs.stat(dst, function (err, stats2) {
                                if (!err && stats2.size == stats.size) {
                                    resolve("File already exists. Skipping copy of: " + src);
                                    resolve2();
                                }
                                else {
                                    fs.ensureDir(path.dirname(dst), err => {
                                        if (err) {
                                            reject(err);
                                            resolve2();
                                        }
                                        else {
                                            switch (self.action) {
                                                case "move":
                                                case "copy":
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

                                                    let writeStream = fs.createWriteStream(dst);
                                                    writeStream.on('close', function () {
                                                        resolve("Finished transfer of: " + src);
                                                        resolve2();
                                                    });
                                                    writeStream.on('error', function (err) {
                                                        reject(err);
                                                        resolve2();
                                                    });
                                                    readStream.pipe(writeStream);
                                                    break;
                                                case "symlink":
                                                default:
                                                    self.action = "symlink";
                                                    fs.ensureSymlink(src, dst, function (err) {
                                                        if (err) {
                                                            reject(err);
                                                            resolve2();
                                                        }
                                                        else {
                                                            resolve("Finished symlinking of: " + src);
                                                            resolve2();
                                                        }
                                                    });
                                            }
                                        }
                                    })
                                }
                            });
                        }
                    });
                });
            });
    });
};

LOCAL.prototype.close_connection = function () {};

LOCAL.prototype.is_connected = function () {
    return true;
};

let workers = {};

module.exports = function(params) {
    let {box, box_idx, route, route_idx, server, transfer, config} = params;
    if (server.protocol !== 'local') throw "Server protocol does not match module. It should be local";
    let target = sprintf(server.file, transfer);
    let source = transfer.source;

    let destination = {action: server.local.action};

    let destination_key = JSON.stringify(destination);
    if (!workers.hasOwnProperty(destination_key)) workers[destination_key] = new LOCAL(destination);

    return workers[destination_key].transfer_file(source, target);
};