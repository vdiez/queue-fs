let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let ssh = require('../../helpers/ssh');

module.exports = function(params) {
    let {box, box_idx, route, route_idx, server, transfer, config} = params;
    if (server.protocol !== 'lftp') throw "Server protocol does not match module. It should be lftp";
    let dirname = path.posix.dirname(transfer.target);
    let tmp = path.posix.join(dirname, ".transferring", path.basename(transfer.target));
    let tmp_dirname = path.posix.dirname(tmp);

    return ssh({
        host: box.ip,
        cmd: "sudo mkdir -p '" + dirname + "' '" + tmp_dirname + "'; sudo chown upop '" + dirname + "' '" + tmp_dirname + "'; lftp -u " + server.lftp.user + "," + server.lftp.pass + " " + server.ip + " -p " + server.lftp.port + ' -e "set net:timeout 10; set net:max-retries 1; set xfer:clobber yes; pget -c -n ' + route.concurrency + " '" + sprintf(server.file, transfer).replace(/'/g, "\\'").replace(/"/g, "\\\"") + "' -o '" + tmp.replace(/'/g, "\\'").replace(/"/g, "\\\"") + '\'; bye" && mv -f "' + tmp.replace(/"/g, "\\\"") + '" "' + transfer.target.replace(/"/g, "\\\"") + '"',
        username: box.username || route.username || config.default_username,
        password: box.password || route.password || config.default_password,
        id: box.ip + " " + route_idx
    });
};