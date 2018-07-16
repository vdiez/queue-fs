let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let fs = require('fs-extra');

module.exports = (params) => {
    let actions = [];
    actions.push({action: "local", critical:true, params: file => {
        let filename = path.posix.join(file.dirname, file.filename);
        if (file.size) params.parser_data = {total: file.size};
        else params.parser_data = fs.stat(filename);

        return Promise.resolve(params.parser_data)
            .then(stats => {
                if (stats.size) params.parser_data = {total: stats.size};
                let target = sprintf(params.target, file).replace(/"/g, "\\\"");
                params.progress = "aspera";
                params.options = {env: {ASPERA_SCP_PASS: params.password}};
                params.cmd = "ascp -T --policy=fair -l 200m -k 1 -P " + (params.port || 22) + " -O " + (params.fasp_port || 33001) + " --user " + params.username + " " + filename + ' "' + params.host + ":" + target + '"';
                return params;
            })
    }});
    actions.push({action: "wamp", requisite: file => file.property === "original", params: {method: "publish", topic: "update_clip", xargs: file => ({clip_id: file.clip_id, type: file.type, event: "delivered", box: {name: params.destination_name}})}});
    return actions;
};