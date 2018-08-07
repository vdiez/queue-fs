let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let fs = require('fs-extra');

module.exports = params => {
    let actions = [];
    actions.push({action: "local", critical:true, params: file => {
        let source = file.dirname;
        if (params.hasOwnProperty('source')) source = params.source;
        source = sprintf(source, file);
        if (!params.source_is_filename) source = path.posix.join(source, file.filename);
        let target = sprintf(params.target, file);
        if (!params.target_is_filename) target = path.posix.join(target, file.filename);

        if (file.size) params.parser_data = {total: file.size};
        else params.parser_data = fs.stat(source);

        return Promise.resolve(params.parser_data)
            .then(stats => {
                if (stats.size) params.parser_data = {total: stats.size};
                target = target.replace(/"/g, "\\\"");
                source = source.replace(/"/g, "\\\"");
                params.progress = "aspera";
                params.options = {env: {ASPERA_SCP_PASS: params.password}};
                params.cmd = "ascp -T -d --policy=fair -l 200m -k 1 -P " + (params.port || 22) + " -O " + (params.fasp_port || 33001) + " --user " + params.username + ' "' + source + '" "' + params.host + ":" + path.posix.dirname(target) + '"';
                return params;
            })
    }});
    actions.push({action: "wamp", requisite: file => file.property === "original", params: {method: "publish", topic: "update_clip", xargs: file => ({clip_id: file.clip_id, type: file.type, event: "delivered", box: {name: params.destination_name}})}});
    return actions;
};