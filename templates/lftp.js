module.exports = params => {
    let actions = [];
    actions.push({action: "remote", critical:true, params: file => {
        let sprintf = require('sprintf-js').sprintf;
        let path = require('path');
        let target = params.target || './', source = file.dirname;
        if (params.hasOwnProperty('source')) source = params.source;
        source = sprintf(source, file);
        if (!params.source_is_filename) source = path.posix.join(source, file.filename);
        target = sprintf(target, file);
        if (!params.target_is_filename) target = path.posix.join(target, file.filename);

        let dirname = path.posix.dirname(target);
        let tmp = target;

        let cmd = "sudo mkdir -p '" + dirname + "'; sudo chown " + (params.username || config.default_username) + " '" + dirname + "';";
        if (!params.direct) {
            tmp = path.posix.join(dirname, ".transferring", path.basename(file.filename));
            cmd += "sudo mkdir -p '" + path.posix.dirname(tmp) + "'; sudo chown " + (params.username || config.default_username) + " '" + path.posix.dirname(tmp) + "';";
        }

        cmd += "lftp -u " + params.origin_username + "," + params.origin_password + " " + params.origin_host + " -p " + (params.origin_port || 21);
        cmd += ' -e "set net:timeout 10; set net:max-retries 1; set xfer:clobber yes; pget -c -n ' + (params.concurrency || 8);
        cmd += " '" + source.replace(/'/g, "\\'").replace(/"/g, "\\\"") + "' -o '" + tmp.replace(/'/g, "\\'").replace(/"/g, "\\\"") + '\'; bye" ';
        if (!params.direct) cmd += '&& mv -f "' + tmp.replace(/"/g, "\\\"") + '" "' + target.replace(/"/g, "\\\"") + '"';

        return {
            host: params.host,
            job_id: params.job_id,
            description: params.description,
            progress: "lftp",
            cmd: cmd,
            cmd_ready: true,
            username: params.username,
            password: params.password
        };
    }});
    return actions;
};