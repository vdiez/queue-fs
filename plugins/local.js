let spawn = require('execa');
let path = require('path');
let fs = require('fs-extra');
let shlex = require('shlex').split;

module.exports = (actions, config) => {
    if (!actions.hasOwnProperty('local')) {
        actions.local = (file, params) => {
            if (!params || !params.cmd) throw "Missing command line";
            params.cmd = [].concat(params.cmd);
            let parser;
            let logs = [], stderr_log, stdout_log;
            let resolve_pause, reject_pause, child;

            if (params.logs && params.logs.stdout) logs.push({filename: path.basename(params.logs.stdout), path: params.logs.stdout});
            if (params.logs && params.logs.stderr) logs.push({filename: path.basename(params.logs.stderr), path: params.logs.stderr});

            if (params.publish && params.progress) parser = require('./stream_parsers')(config.logger, params.progress, params.publish, params.parser_data);

            if (params.job_id && params.controllable && config.controllers) {
                if (!config.controllers.hasOwnProperty(params.job_id)) config.controllers[params.job_id] = {value: "resume"};
                config.controllers[params.job_id].control = action => {
                    config.controllers[params.job_id].value = action;
                    config.logger.info("Received command: ", action);
                    if (action === "stop") {
                        if (child) {
                            if (process.platform === "win32") {
                                let stop = spawn("pskill", ["-t", child.pid], {buffer: false});
                                stop.catch(err => config.logger.error("Could not kill process:", err));
                            }
                            else child.kill("SIGKILL");
                        }
                        if (reject_pause) {
                            reject_pause();
                            reject_pause = null;
                        }
                    }
                    else if (action === "pause" && child) {
                        if (process.platform === "win32") {
                            let pause = spawn("pssuspend", [child.pid], {buffer: false});
                            pause.catch(err => config.logger.error("Could pause process:", err));
                        }
                        else child.kill("SIGSTOP");
                    }
                    else if (action === "resume") {
                        if (child) {
                            if (process.platform === "win32") {
                                let resume = spawn("pssuspend", ["-r", child.pid], {buffer: false});
                                resume.catch(err => config.logger.error("Could not resume process:", err));
                            }
                            else child.kill("SIGCONT");
                        }
                        if (resolve_pause) {
                            resolve_pause();
                            resolve_pause = null;
                        }
                    }
                };
            }

            return new Promise((resolve,reject) => {
                logs.reduce((p, log) => p.then(() => log && log.path && fs.ensureDir(path.dirname(log.path))), Promise.resolve())
                    .then(() => {
                        config.logger.debug("Executing " + params.cmd);
                        if (params.logs && params.logs.stdout) stdout_log = fs.createWriteStream(params.logs.stdout);
                        if (params.logs && params.logs.stderr) stderr_log = fs.createWriteStream(params.logs.stderr);
                    })
                    .then(() => {
                        return params.cmd.reduce((p, cmd) => {
                            return p
                                .then(() => {
                                    if (params.job_id && params.controllable && config.controllers) {
                                        if (config.controllers[params.job_id].value === "stop") throw "Task has been cancelled";
                                        if (config.controllers[params.job_id].value === "pause") {
                                            config.logger.info("Local action paused: ", cmd);
                                            return new Promise((resolve, reject) => {
                                                resolve_pause = resolve;
                                                reject_pause = reject;
                                            });
                                        }
                                    }
                                })
                                .then(() => {
                                    let command_line = shlex(cmd);
                                    child = spawn(command_line.shift(), command_line, {buffer: false, ...(params.options || {})});
                                    if (parser || logs.length) {
                                        child.stderr.on('data', data => {
                                            if (parser) parser.parse(data);
                                            if (params.logs && params.logs.stderr) stderr_log.write(data);
                                        });
                                        child.stdout.on('data', data => {
                                            if (parser) parser.parse(data);
                                            if (params.logs && params.logs.stdout) stdout_log.write(data);
                                        });
                                    }
                                    if (params.priority) {
                                        let renice = spawn('renice', [params.priority, '-p', child.pid], {buffer: false});
                                        //renice.stdout.pipe(process.stdout);
                                        renice.catch(err => config.logger.error("Could not change priority of process:", err));
                                    }
                                    return child;
                                })
                                .then(() => {
                                    child = null;
                                })
                        }, Promise.resolve());
                    })
                    .catch(err => {
                        reject({err, data: parser && parser.data, logs: logs});
                    })
                    .then(result => {
                        resolve(parser && parser.data);
                    })
                    .then(() => params.logs && params.logs.stdout && new Promise(resolve => stdout_log.end(resolve)))
                    .then(() => params.logs && params.logs.stderr && new Promise(resolve => stderr_log.end(resolve)))
                    .then(() => params.logs && setTimeout(() => logs.forEach(log => fs.remove(log.path).catch(err => config.logger.error("Could not remove stdout log file: " + err))), 30000));
            });
        };
    }
    return actions;
};