let config = require('../config');

function main_file(type, extension) {
    if (config.main_file && config.main_file[type]) {
        let main_files = [].concat(config.main_file[type]);
        return main_files.includes(extension.toLowerCase());
    }
    let defaults = [].concat(config.default_main_file || ".mxf");
    return defaults.includes(extension.toLowerCase());
}

module.exports = function(actions) {
    if (!actions.hasOwnProperty('monitor')) {
        actions.monitor = function (params) {
            if (params.wamp.session && params.type && params.clip_id && params.stat && main_file(params.type, params.extension))
                return params.wamp.session.call('update_clips', [], {clip_ids: params.clip_id, type: params.type, origin: params.origin || "", box: params.box || "", event: params.event || "pending", size: params.stat.size, info: params.data || 0});
        }
    }
    return actions;
};