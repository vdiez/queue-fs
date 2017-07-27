let fs = require('fs-extra');
let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let config = require('./config');
let VERBOSE_LEVEL = config.verbosity || 1;

function ERROR() {VERBOSE_LEVEL >= 0 && console.log.apply(console, arguments);}
function WARN() {VERBOSE_LEVEL >= 1 && console.log.apply(console, arguments);}
function DEBUG() {VERBOSE_LEVEL >= 2 && console.log.apply(console, arguments);}

let queue = {};
let functions = {};

module.exports = function(file, actions, description) {
    actions = [].concat(actions);
    let promises = [];
    let configuration;

    for (let i = 0; i < actions.length; i++) {
        let method = undefined;
        if (functions.hasOwnProperty(actions[i].action)) method = functions[actions[i].action];
        else if (typeof actions[i].action === "function") method = actions[i].action;
        else {
            try {
                require('./plugins/' + actions[i].action)(functions);
                if (functions.hasOwnProperty(actions[i].action)) method = functions[actions[i].action];
            }
            catch(e) {}
        }
        if (!method) continue;

        let requisite = actions[i].requisite;

        // Avoid reusing same params all time -> corrupted params object
        let params = {};
        if (actions[i].hasOwnProperty('params')) try {params = JSON.parse(JSON.stringify(actions[i].params));} catch(e) {params = {};}

        for (let attr in file) if (file.hasOwnProperty(attr)) params[attr] = file[attr];

        if (!params.hasOwnProperty('source')) params.source = params.dirname;
        if (!params.source_is_filename) params.source = path.join(params.source, params.filename);

        if (params.hasOwnProperty('target')) {
            try {configuration = JSON.parse(fs.readFileSync('priorities.json'));} catch(e) {configuration = {};}
            if (configuration.hasOwnProperty(params.target)) {
                let assigned = false;
                for (let priority in configuration[params.target]) {
                    if (configuration[params.target].hasOwnProperty(priority)) {
                        let matches = [].concat(configuration[params.target][priority]);
                        for (let j = 0; j < matches.length; j++) {
                            if (params.path.toLowerCase().includes(matches[j].toLowerCase()) || matches[j] == "*") {
                                params.target = path.join(params.target, priority);
                                assigned = true;
                                break;
                            }
                        }
                        if (assigned) break;
                    }
                }
            }
            if (!params.target_is_filename) params.target = path.join(params.target, params.filename);
        }

        params.description = description;
        if (!params.description) {
            if (typeof actions[i].action === "function") params.description = actions[i].action.name;
            else params.description = actions[i].action;
            params.description += " " + params.source + (params.target ? " to " + params.target : "");
        }

        if (params.hasOwnProperty('queue')) params.queue = sprintf(params.queue, params);
        else params.queue = params.path;

        if (params.hasOwnProperty('awaits')) {
            let awaits = [].concat(params.awaits);
            let queues = [];
            for (let j = 0; j < awaits.length; j++) queues.push(queue[sprintf(awaits[j], params)]);
            params.awaits = Promise.all(queues);
        }
        else params.awaits = queue[params.queue];

        promises.push(new Promise(function(resolve, reject) {
            queue[params.queue] = Promise.resolve(params.awaits)
                .then(function(inherits) {
                    if (inherits) for (let attr in inherits) if (inherits.hasOwnProperty(attr)) params[attr] = inherits[attr];
                    if (params.hasOwnProperty('target')) params.target = sprintf(params.target, params);
                    params.source = sprintf(params.source, params);
                    DEBUG("Starting " + params.description);
                    return !requisite || requisite(params) ? method(params) : 0;
                })
                .then(function(result) {
                    DEBUG("Completed " + params.description);
                    resolve();
                    if (params.post) {
                        let fields = [].concat(params.post);
                        let inheritance = {};
                        for (let i = 0; i < fields.length; i++) {
                            if (params.hasOwnProperty(fields[i])) inheritance[fields[i]] = params[fields[i]];
                        }
                        return inheritance;
                    }
                })
                .catch(function(reason) {
                    WARN("Failed " + params.description + ". Error: " + reason);
                    resolve({error: reason, path: params.path});
                    if (params.post) {
                        let fields = [].concat(params.post);
                        let inheritance = {};
                        for (let i = 0; i < fields.length; i++) {
                            if (params.hasOwnProperty(fields[i])) inheritance[fields[i]] = params[fields[i]];
                        }
                        return inheritance;
                    }
                });
        }));
    }

    return Promise.all(promises);
};