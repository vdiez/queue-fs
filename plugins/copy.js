let path = require('path');
let endpoint = require('./helpers/endpoint');
let connection_limiter = require('./helpers/connection_limiter');
let protoclients = require('../../protoclients');

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('copy')) {
        actions.copy = (file, params) => {
            if (!params) throw "Missing parameters";
            let origin_params = {parallel_connections: params.parallel_connections};
            for (let param in params) {
                if (params.hasOwnProperty(param) && param.startsWith('origin_')) origin_params[param.slice(7)] = params[param];
            }

            let streams = {passThrough: new (require('stream')).PassThrough()},
                stopped, final, stats, done = false,
                source = endpoint(file, params, 'source'),
                target = endpoint(file, params, 'target');

            if (params.job_id && params.controllable && config.controllers) {
                if (!config.controllers.hasOwnProperty(params.job_id)) config.controllers[params.job_id] = {value: "resume"};
                config.controllers[params.job_id].control = action => {
                    config.controllers[params.job_id].value = action;
                    config.logger.info("Received command: ", action);
                    if (action === "stop") {
                        if (streams.readStream) streams.readStream?.destroy("Task has been cancelled");
                        stopped = true;
                    }
                    else if (action === "pause") {
                        if (streams.readStream) {
                            streams.readStream.unpipe();
                            if (streams.writeStream) streams.passThrough.unpipe();
                        }
                    }
                    else if (action === "resume") {
                        if (streams.readStream) {
                            streams.readStream.pipe(streams.passThrough);
                            if (streams.writeStream) streams.passThrough.pipe(streams.writeStream);
                        }
                    }
                };
            }

            return new Promise((resolve_session, reject_session) => connection_limiter(origin_params, config.logger)
                .then(({connection, resolve_slot}) => {
                    let source_connection = connection;
                    let resolve_source_slot = resolve_slot;
                    return source_connection.stat(source)
                        .then(result => {
                            stats = result;
                            if (stats.isDirectory()) throw "Cannot copy directory";
                            if (connection_limiter.are_equal(origin_params, params)) {
                                return source_connection.stat(target).catch(() => {})
                                    .then(stats_target => {
                                        if (stats_target) {
                                            if (stats_target.size === stats.size) throw {file_exists: true};
                                            if (stats_target.isDirectory()) throw {is_directory: true};
                                            if (params.force) return source_connection.remove(target);
                                            throw {cannot_overwrite: true};
                                        }
                                    })
                                    .then(() => {
                                        if (params.link_if_possible) {
                                            return source_connection.link(source, target)
                                                .then(() => {throw {created_link: true}})
                                                .catch(err => {
                                                    if (err.created_link) throw err;
                                                    config.logger.info("Link creation failed: ", err)
                                                })
                                        }
                                    })
                                    .then(() => {
                                        if (params.symlink_if_possible) {
                                            return source_connection.symlink(source, target)
                                                .then(() => {throw {created_symlink: true}})
                                                .catch(err => {
                                                    if (err.created_symlink) throw err;
                                                    config.logger.info("Symlink creation failed: ", err)
                                                })
                                        }
                                    })
                                    .then(() => {
                                        if (params.direct) return source_connection.mkdir(path.posix.dirname(target));
                                        final = target;
                                        target = path.posix.join(path.posix.dirname(target), ".tmp", path.posix.basename(target));
                                        return source_connection.stat(target)
                                            .catch(() => {})
                                            .then(stats_target => {
                                                if (stats_target) {
                                                    if (stats_target.size === stats.size) throw {tmp_exists: true};
                                                    if (stats_target.isDirectory()) throw {tmp_is_directory: true};
                                                    return source_connection.remove(target);
                                                }
                                            })
                                            .then(() => source_connection.mkdir(path.posix.dirname(target)));
                                    })
                                    .then(() => source_connection.copy(source, target, streams, stats?.size || file.size, params))
                                    .catch(err => {
                                        if (err) {
                                            if (err.created_symlink) {
                                                config.logger.info(target + " created as symlink");
                                                done = true;
                                            }
                                            else if (err.created_link) {
                                                config.logger.info(target + " created as hardlink");
                                                done = true;
                                            }
                                            else if (err.is_directory) {
                                                config.logger.info(target + " exists and is a directory");
                                                throw err;
                                            }
                                            else if (err.tmp_is_directory) {
                                                config.logger.info(target + " exists and is a directory");
                                                throw err;
                                            }
                                            else if (err.cannot_overwrite) {
                                                config.logger.info(target + " exists with different size and overwrite flag is not enabled");
                                                throw err;
                                            }
                                            else if (err.not_implemented) {
                                                config.logger.info("Local copy not implemented on protocol " + origin_params.protocol + ". Trying different connections.");
                                            }
                                            else if (err.file_exists) {
                                                config.logger.info(target + " already exists");
                                                done = true;
                                            }
                                            else if (err.tmp_exists && !params.direct) {
                                                config.logger.info(target + " already exists. Moving to final destination");
                                                return source_connection.move(target, final, stats?.size || file.size, params)
                                                    .then(() => done = true)
                                                    .catch(err => {
                                                        config.logger.info("Moving '" + target + "' to final destination failed. Error: ", err);
                                                        throw err;
                                                    });
                                            }
                                            else config.logger.info("Unknown error on local copy. Trying different connections. ", err);
                                        }
                                        else config.logger.info("Unknown error on local copy. Trying different connections. ", err);
                                    })
                            }
                        })
                        .then(() => {
                            if (done) return;
                            return connection_limiter(params, config.logger)
                                .then(({connection, resolve_slot}) => {
                                    let target_connection = connection;
                                    let resolve_target_slot = resolve_slot;
                                    return target_connection.stat(target).catch(() => {})
                                        .then(stats_target => {
                                            if (stats_target) {
                                                if (stats_target.size === stats.size) throw {file_exists: true};
                                                if (stats_target.isDirectory()) throw {is_directory: true};
                                                if (params.force) return target_connection.remove(target);
                                                throw {cannot_overwrite: true};
                                            }
                                        })
                                        .then(() => {
                                            if (params.direct) return target_connection.mkdir(path.posix.dirname(target));
                                            final = target;
                                            target = path.posix.join(path.posix.dirname(target), ".tmp", path.posix.basename(target));
                                            return target_connection.stat(target)
                                                .catch(() => {})
                                                .then(stats_target => {
                                                    if (stats_target) {
                                                        if (stats_target.size === stats.size) throw {tmp_exists: true};
                                                        if (stats_target.isDirectory()) throw {tmp_is_directory: true};
                                                        return target_connection.remove(target);
                                                    }
                                                })
                                                .then(() => target_connection.mkdir(path.posix.dirname(target)));
                                        })
                                        .then(() => source_connection.createReadStream(source))
                                        .then(stream => {
                                            streams.readStream = stream;
                                            return target_connection.copy(source, target, streams, stats?.size || file.size, params)
                                        })
                                        .then(() => {
                                            if (stopped) throw "Task has been cancelled";
                                            if (!params.direct) return target_connection.move(target, final, stats?.size || file.size, params);
                                        })
                                        .catch(err => {
                                            streams.readStream?.destroy();
                                            streams.passThrough?.destroy();
                                            streams.writeStream?.destroy();
                                            if (err.is_directory) {
                                                config.logger.info(target + " exists and is a directory");
                                                throw err;
                                            }
                                            else if (err.tmp_is_directory) {
                                                config.logger.info(target + " exists and is a directory");
                                                throw err;
                                            }
                                            else if (err.cannot_overwrite) {
                                                config.logger.info(target + " exists with different size and overwrite flag is not enabled");
                                                throw err;
                                            }
                                            else if (err.file_exists) config.logger.info(target + " already exists");
                                            else if (err.tmp_exists && !params.direct) {
                                                config.logger.info(target + " already exists. Moving to final destination");
                                                return target_connection.move(target, final, stats?.size || file.size, params).catch(err => {
                                                    config.logger.info("Moving '" + target + "' to final destination failed. Error: ", err);
                                                    throw err;
                                                });
                                            }
                                            else {
                                                //target_connection.remove(target).catch(err => config.logger.error("Could not remove unfinished destination: ", err))
                                                throw err;
                                            }
                                        })
                                        .catch(err => reject_session(err))
                                        .then(() => resolve_target_slot())
                                })
                        })
                        .catch(err => reject_session(err))
                        .then(() => {
                            resolve_session();
                            resolve_source_slot();
                        })
                }
            ))
        };
    }
    return actions;
};
