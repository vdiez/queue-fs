let mongodb = require('mongodb');

module.exports = (params, config) => {
    let actions = [];
    let db;
    params.make_public = true;
    actions.push({action: "aws_s3", requisite: file => file.property !== "logging", critical:true, params: params});
    actions.push({id: "ffprobe_metadata", requisite: file => file.property !== "logging" && file.property !== "thumbnail", action: "local", critical:true, params: file => new Promise((resolve, reject) => {
            if (db) return resolve();
            mongodb.MongoClient.connect(new mongodb.Server(config.db_host, config.db_port), (err, client) => {
                if (err) return reject('MongoDB error while connecting: ', err);
                db = client.db(config.db_name);
                db.on('close', () => {
                    db = false;
                    winston.error('MongoDB disconnected');
                });
                resolve();
            });
        })
        .then(() => db.collection(config.db_files).findOne({clip_id: file.clip_id, property: "thumbnail", type: file.type}))
        .then(result => {if (result) file.results['thumbnail'] = result})
        .then(() => db.collection(config.db_files).findOne({clip_id: file.clip_id, property: "original", type: file.type}))
        .then(result => {
            if (!result) throw "Original file for " + file.filename + " is not available. Failed ffprobe";
            return {
                job_id: params.job_id,
                cmd: "ffprobe %(source)s",
                progress: "ffprobe",
                source: result._id,
                source_is_filename: true
            };
        })
    });
    actions.push({action: "rest_call", requisite: file => file.property !== "logging" && file.property !== "thumbnail", critical: true, params: file => {
        let path = require('path');
        let sprintf = require('sprintf-js').sprintf;
        let target = params.target || './';
        target = sprintf(target, file);
        if (!params.target_is_filename) target = path.posix.join(target, file.filename);

        let body = {
            //"url": "https://s3." + params.region + ".amazonaws.com/" + params.bucket + "/" + file.filename,
            "url": encodeURI("http://" + params.bucket + ".s3.amazonaws.com/" + path.posix.normalize(target)),
            "assetName": file.asset_name,
            "eventId": file.event_id,
            "tcIn": file.results['ffprobe_metadata'].timecode,
            "duration": file.results['ffprobe_metadata'].duration
        };
        if (file.results['thumbnail']) {
            let thumb = params.target || './';
            thumb = sprintf(target, file.results['thumbnail']);
            if (!params.target_is_filename) thumb = path.posix.join(thumb, file.filename);
            body.thumbnail = encodeURI("http://" + params.bucket + ".s3.amazonaws.com/" + path.posix.normalize(thumb));
        }

        return {request: {
                url: "https://exchange-manager-api.platform.labs.pm/v1/requests",
                    method: 'POST',
                    headers: {
                    'X-Api-Key': params.api_key
                },
                json: {
                    "client_id": params.api_id,
                        "name": "ingest_video_asset",
                        "inputs": {
                        "video_parameters": {
                            "value": new Buffer(JSON.stringify(body)).toString("base64"),
                                "type": "binary"
                        }
                    }
                }
        }};
    }});
    actions.push({id: "logging_contents", action: "read", requisite: file => file.property === "logging", critical: true, params: params});
    actions.push({action: "rest_call", requisite: file => file.property === "logging", critical: true, params: file => ({request: {
        url: "https://exchange-manager-api.platform.labs.pm/v1/requests",
        method: 'POST',
        headers: {
            'X-Api-Key': params.api_key
        },
        json: {
            "client_id": params.api_id,
            "name": "ingest_live_logging",
            "inputs": {
                "live_logging": {
                    "value": new Buffer(file.results['logging_contents']).toString("base64"),
                    "type": "binary"
                }
            }
        }
    }})});
    return actions;
};