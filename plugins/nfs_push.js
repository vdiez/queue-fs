let path = require('path');
let Client = require('node-nfsc');
let fs = require('fs-extra');
let sprintf = require('sprintf-js').sprintf;

let queues = {};
let servers = {};
let arbiter = {};
let pending = {};
let parallel_connections;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('nfs_push')) {
        actions.nfs_push = (file, params) => {
            if (!params) throw "Missing parameters";
            if (!params.host) throw "Missing hostname";
            if (!params.exportPath) throw "Missing export path";

            if (!parallel_connections && !params.parallel_connections) parallel_connections = 10;
            if (params.parallel_connections) {
                parallel_connections = parseInt(params.parallel_connections, 10);
                if (!parallel_connections && (isNaN(parallel_connections) || parallel_connections < 1)) parallel_connections = 10;
            }

            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.posix.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.posix.join(target, file.filename);

            let resolve_pause, reject_pause, readStream, stopped, stats, final, target_handler, final_handler, filename = path.posix.basename(target);
            let passThrough = new (require('stream')).PassThrough();//we use PassThrough because once we pipe filestream, pause will not have any effect
            let parameters = {host: params.host, exportPath: params.exportPath, uid: params.uid, gid: params.gid};
            let id = JSON.stringify(parameters);
            if (!arbiter.hasOwnProperty(id)) {
                arbiter[id] = 0;
                pending[id] = 0;
                queues[id] = new Array(parallel_connections).fill(1).map((_, idx) => idx);
                servers[id] = new Array(parallel_connections).fill(null);
            }

            for (let i = queues[id].length; i < parallel_connections; i++) {//if parallel_connections have been increased
                queues[id].push(i);
                servers[id].push(null);
            }

            while (queues[id].length > parallel_connections) {//if parallel_connections have been reduced
                servers[id].pop();
                queues[id].pop();
            }

            pending[id]++;

            if (params.job_id && params.controllable && config.controllers) {
                if (!config.controllers.hasOwnProperty(params.job_id)) config.controllers[params.job_id] = {value: "resume"};
                config.controllers[params.job_id].control = action => {
                    config.controllers[params.job_id].value = action;
                    config.logger.info("Received command: ", action);
                    if (action === "stop") {
                        if (readStream) {
                            passThrough.end();
                            stopped = true;
                        }
                        if (reject_pause) {
                            reject_pause();
                            reject_pause = null;
                        }
                    }
                    else if (action === "pause" && readStream) readStream.unpipe();
                    else if (action === "resume") {
                        if (readStream) readStream.pipe(passThrough);
                        if (resolve_pause) {
                            resolve_pause();
                            resolve_pause = null;
                        }
                    }
                };
            }

            return new Promise((resolve, reject) => {
                arbiter[id] = Promise.resolve(arbiter[id])
                    .then(() => {
                        return new Promise(resolve_arbiter => {
                            return Promise.race(queues[id])
                                .then(queue => {
                                    let current_server = servers[id][queue];
                                    if (!current_server) current_server = new Client.V3(parameters);
                                    queues[id][queue] = Promise.resolve(queues[id][queue])
                                        .then(() => {
                                            if (params.job_id && params.controllable && config.controllers) {
                                                if (config.controllers[params.job_id].value === "stop") throw "Task has been cancelled";
                                                if (config.controllers[params.job_id].value === "pause") {
                                                    config.logger.info("NFS put paused");
                                                    return new Promise((resolve, reject) => {
                                                        resolve_pause = resolve;
                                                        reject_pause = reject;
                                                    });
                                                }
                                            }
                                        })
                                        .then(() => fs.stat(source))
                                        .then(result => {
                                            stats = result;
                                            if (stats.isDirectory()) throw "Cannot copy directory";
                                            return new Promise((resolve_mount, reject_mount) => {
                                                current_server.mount((err, root) => {
                                                    if (err) reject_mount(err);
                                                    else resolve_mount(root);
                                                });
                                            });
                                        })
                                        .then(root => {
                                            if (!params.direct) {
                                                final = target;
                                                target = path.posix.join(path.posix.dirname(target), ".tmp", path.posix.basename(target));
                                            }
                                            return path.posix.dirname(target).split('/').reduce((p, entry, i, paths) => p.then(parent => new Promise((resolve_mkdir, reject_mkdir) => {
                                                if (!params.direct && i === paths.length - 1) final_handler = parent;
                                                if (!entry || entry === "/" || entry === ".") return resolve_mkdir(parent);
                                                current_server.lookup(parent, entry, (err, entry_obj, entry_attrs, parent_attr) => {
                                                    if (err) {
                                                        if (err.status === 'NFS3ERR_NOENT') current_server.mkdir(parent, entry, {mode: 0o775}, (err, new_entry, attrs, wcc) => {
                                                            if (!err && new_entry) resolve_mkdir(new_entry);
                                                            else reject_mkdir(err);
                                                        });
                                                        else reject_mkdir(err);
                                                    } else {
                                                        if (entry_attrs.type === "NF3DIR") resolve_mkdir(entry_obj);
                                                        else reject_mkdir(entry + " already exists and it's not a directory");
                                                    }
                                                })
                                            })), Promise.resolve(root));
                                        })
                                        .then(handler => {
                                            target_handler = handler;
                                            return new Promise((resolve_size, reject_size) => current_server.lookup(target_handler, filename, (err, entry, attrs) =>  {
                                                if (err) resolve_size();
                                                else {
                                                    if (attrs.size === stats.size) reject_size(params.direct ? {file_exists: true} : {tmp_exists: true});
                                                    else current_server.remove(target_handler, filename, err => {
                                                        if (err) reject_size(err);
                                                        else resolve_size();
                                                    });
                                                }
                                            }))
                                        })
                                        .then(() => {
                                            if (params.direct) return;
                                            return new Promise((resolve_size, reject_size) => current_server.lookup(final_handler, filename, (err, entry, attrs) =>  {
                                                if (err) resolve_size();
                                                else {
                                                    if (attrs.size === stats.size) reject_size({file_exists: true});
                                                    else current_server.remove(final_handler, filename, err => {
                                                        if (err) reject_size(err);
                                                        else resolve_size();
                                                    });
                                                }
                                            }))
                                        })
                                        .then(() => new Promise((resolve_transfer, reject_transfer) => {
                                            current_server.create(target_handler, filename, current_server.CREATE_GUARDED, {mode: stats.mode & parseInt('777',8)}, (err, object, obj_attrs) => {
                                                readStream = fs.createReadStream(source, { highWaterMark: 32 * 1024 });
                                                readStream.pipe(passThrough);
                                                readStream.on('close', () => {
                                                    if (stopped) reject_transfer("Task has been cancelled");
                                                    else {
                                                        if (params.direct) resolve_transfer();
                                                        else current_server.rename(target_handler, filename, final_handler, filename, err => {
                                                            if (err) reject_transfer(err);
                                                            else resolve_transfer();
                                                        });
                                                    }
                                                });
                                                readStream.on('error', err => reject_transfer(err));
                                                passThrough.on('error', err => reject_transfer(err));

                                                let transferred = 0;
                                                let percentage = 0;
                                                passThrough.pipe(new (require('stream').Writable)({
                                                    write(data, encoding, callback) {
                                                        transferred += data.length;
                                                        current_server.write(object, data.length, transferred, current_server.WRITE_UNSTABLE, data, (err, commited, count, verf, wcc) => {
                                                            if (err) callback(err);
                                                            else {
                                                                if (params.publish) {
                                                                    let tmp = Math.round(transferred * 100 / stats.size);
                                                                    if (percentage != tmp) {
                                                                        percentage = tmp;
                                                                        params.publish({current: transferred, total: stats.size, percentage: percentage});
                                                                    }
                                                                }
                                                                callback();
                                                            }
                                                        });
                                                    }
                                                }));
                                            });
                                        }))
                                        .catch(err => {
                                            if (readStream) readStream.destroy();
                                            if (passThrough) passThrough.destroy();
                                            if (err && err.file_exists) config.logger.info(target + " already exists");
                                            else if (err && err.tmp_exists && !params.direct) {
                                                config.logger.info(target + " already exists. Moving to final destination");
                                                return new Promise((resolve_rename, reject_rename) => current_server.rename(target_handler, filename, final_handler, filename, err => {
                                                    if (err) reject_rename(err);
                                                    else resolve_rename();
                                                }))
                                            }
                                            else {
                                                if (reject_pause) reject_pause(err);
                                                reject(err);
                                                if (current_server) current_server.remove(target_handler, filename, err => err && config.logger.error("Could not remove unfinished destination: ", err));
                                            }
                                        })
                                        .then(() => {
                                            resolve();
                                            pending[id]--;
                                            if (queue >= parallel_connections && current_server) current_server.unmount(err => err && self.logger.error("Error disconnecting NFS mount: ", err));
                                            else servers[id][queue] = current_server;
                                            return queue;
                                        });
                                    resolve_arbiter();
                                })
                        });
                    })
            });
        };
    }
    return actions;
};
