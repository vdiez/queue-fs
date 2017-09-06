module.exports = function(actions, db, config) {
    function main_file(type, extension) {
        if (config && config.main_file && config.main_file[type]) {
            let main_files = [].concat(config.main_file[type]);
            return main_files.includes(extension.toLowerCase());
        }
        let defaults = [].concat(config && config.default_main_file || ".mxf");
        return defaults.includes(extension.toLowerCase());
    }

    if (!actions.hasOwnProperty('monitor_publish')) {
        actions.monitor_publish = function (params) {
            if (params.wamp && params.type && params.clip_id && params.stat && main_file(params.type, params.extension))
                return params.wamp.publish('update_clip', [], {clip_ids: params.clip_id, type: params.type, origin: params.origin || "", event: params.event || "delivered", size: params.stat.size, info: params.data || 0});
        }
    }
    return actions;
};