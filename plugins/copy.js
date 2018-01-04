let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;

module.exports = function(actions) {
    if (!actions.hasOwnProperty('copy')) {
        actions.copy = function (file, params) {
            return new Promise(function (resolve, reject) {
                if (params && params.hasOwnProperty('target')) {
                    let source = file.dirname;
                    if (params.hasOwnProperty('source')) source = params.source;
                    source = sprintf(source, file);
                    if (!params.source_is_filename) source = path.join(source, file.filename);
                    let target = sprintf(params.target, file);
                    if (!params.target_is_filename) target = path.join(target, file.filename);
                    let final;

                    fs.stat(source, (err, stats) => {
                        if (err) return reject();
                        let readStream = fs.createReadStream(source);

                        if (params.tmp) {
                            final = target;
                            target = path.posix.join(path.dirname(target), ".tmp", path.basename(target));
                        }
                        let writeStream = fs.createWriteStream(target);
                        writeStream.on('close', function () {
                            if (params.tmp) {
                                fs.move(target, final, {overwrite: true}, err => {
                                    if (err) reject(err);
                                    else resolve();
                                });
                            }
                            else resolve();
                        });
                        writeStream.on('error', err => reject(err));
                        readStream.on('error', err => reject(err));
                        readStream.pipe(writeStream);

                        let transferred = 0;
                        let percentage = 0;
                        let wamp_router = params.wamp_router || config.default_router;
                        let wamp_realm = params.wamp_realm || config.default_realm;
                        if (params.progress && wamp_router && wamp_realm) {
                            readStream.on('data', function(buffer) {
                                transferred += buffer.length;

                                let tmp = Math.round(transferred * 100 / stats.size);
                                if (percentage != tmp) {
                                    percentage = tmp;
                                    wamp(wamp_router, wamp_realm, 'publish', [params.topic || 'task_progress', [file, {current: transferred, size: stats.size, percentage: percentage}]]);
                                }
                            });
                        }
                    });

                }
                else reject("Target path not specified");
            });
        };
    }
    return actions;
};