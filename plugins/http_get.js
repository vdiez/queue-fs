let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let winston = require('winston');
let request = require('request');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('http_get')) {
        actions.http_get = (file, params) => {
            if (!params) throw "Missing parameters";
            let size;
            let target = file.dirname;
            if (params.hasOwnProperty('target')) target = params.target;
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);
            let source = params.source || './';
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            return new Promise((resolve, reject) => {
                    request.head(source, (err, response, body) => {
                        if (err) reject({not_found: true});
                        else {
                            let headers = response.headers;
                            if (headers && headers['content-length']) size = parseInt(headers['content-length'], 10);
                            resolve();
                        }
                    })
                })
                .then(() => new Promise((resolve, reject) => {
                    fs.stat(target, (err, stats) => {
                        if (err) resolve();
                        else {
                            if (size && (size == stats.size)) reject({file_exists: true});
                            else resolve();
                        }
                    });
                }))
                .then(() => fs.ensureDir(path.dirname(target)))
                .then(() => new Promise((resolve, reject) => {
                    let fileStream = fs.createWriteStream(target);
                    let get_request = request.get(source);
                    get_request.on('response', response => {
                        if (response.statusCode !== 200) return reject('Response status was ' + response.statusCode);
                        if (!size && headers && headers['content-length']) size = parseInt(headers['content-length'], 10);
                    });
                    get_request.on('error', err => {
                        fs.unlink(target);
                        reject(err);
                    });

                    fileStream.on('error', err => {
                        fs.unlink(target);
                        reject(err);
                    });
                    fileStream.on('close', () => resolve());

                    if (params.publish) {
                        let transferred = 0;
                        let percentage = 0;
                        get_request.on('data', data => {
                            if (!size) return;
                            transferred += data.length;
                            let tmp = Math.round(transferred * 100 / size);
                            if (percentage != tmp) {
                                percentage = tmp;
                                params.publish({current: transferred, total: size, percentage: percentage});
                            }
                        });
                    }
                    get_request.pipe(fileStream);
                }))
                .catch(err => {
                    if (err && err.file_exists) return winston.info(target + " already exists");
                    throw err;
                });
        };
    }

    return actions;
};