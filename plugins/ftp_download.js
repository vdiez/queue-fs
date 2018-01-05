let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let ssh = require('../helpers/ssh');
let queue_counter = {};

module.exports = function(actions, config) {
    if (!actions.hasOwnProperty('ftp_download')) {
        actions.ftp_download = function(file, params) {
            let target = params.target || './';
            let source = file.dirname;
            if (params.hasOwnProperty('source')) source = params.source;
            source = sprintf(source, file);
            if (!params.source_is_filename) source = path.join(source, file.filename);
            target = sprintf(target, file);
            if (!params.target_is_filename) target = path.join(target, file.filename);

            let dirname = path.posix.dirname(target);
            let tmp = path.posix.join(dirname, ".transferring", path.basename(params.filename));
            let tmp_dirname = path.posix.dirname(tmp);

            return ssh({
                id: (params.host + queue_counter[params.host]++ % (config.parallel_connections || 5)),
                host: params.host,
                cmd: "sudo mkdir -p '" + dirname + "' '" + tmp_dirname + "'; lftp -u " + params.user + "," + params.pass + " " + params.ftp_ip + " -p " + params.ftp_port + ' -e "set net:timeout 10; set net:max-retries 1; set xfer:clobber yes; pget -c -n ' + params.concurrency + " '" + source.replace(/'/g, "\\'").replace(/"/g, "\\\"") + "' -o '" + tmp.replace(/'/g, "\\'").replace(/"/g, "\\\"") + '\'; bye" && mv -f "' + tmp.replace(/"/g, "\\\"") + '" "' + target.replace(/"/g, "\\\"") + '"',
                username: params.username || config.default_username,
                password: params.password || config.default_password
            });
        };
    }
    return actions;
};