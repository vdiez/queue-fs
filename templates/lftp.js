module.exports = params => {
    let actions = [];
    actions.push({id: "speedtest", action: "local", critical:true, params: file => {
        let target = params.target || './', source = file.dirname;
        if (params.hasOwnProperty('source')) source = params.source;
        source = sprintf(source, file);
        if (!params.source_is_filename) source = path.posix.join(source, file.filename);
        target = sprintf(target, file);
        if (!params.target_is_filename) target = path.posix.join(target, file.filename);

        let dirname = path.posix.dirname(target);
        let tmp = path.posix.join(dirname, ".transferring", path.basename(file.filename));
        let tmp_dirname = path.posix.dirname(tmp);
        let cmd = "sudo mkdir -p '" + dirname + "' '" + tmp_dirname + "'; ";
        cmd += "sudo chown " + (params.username || config.default_username) + " '" + dirname + "' '" + tmp_dirname + "'; ";
        cmd += "lftp -u " + params.origin_username + "," + params.origin_password + " " + params.origin_host + " -p " + (params.origin_port || 21) + ' -e "set net:timeout 10; set net:max-retries 1; set xfer:clobber yes; pget -c -n ' + (params.concurrency || 8) + " '" + source.replace(/'/g, "\\'").replace(/"/g, "\\\"") + "' -o '" + tmp.replace(/'/g, "\\'").replace(/"/g, "\\\"") + '\'; bye" && mv -f "' + tmp.replace(/"/g, "\\\"") + '" "' + target.replace(/"/g, "\\\"") + '"';

        return {
            host: params.host,
            job_id: params.job_id,
            progress: "lftp",
            cmd: cmd,
            username: params.username,
            password: params.password
        };
    }});
    return actions;
};