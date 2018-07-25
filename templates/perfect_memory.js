let mongodb = require('mongodb');

module.exports = (params, config) => {
    let actions = [];
    let db;
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    actions.push({id: "ffprobe_metadata", requisite: file => file.property !== "logging", action: "local", critical:true, params: file => new Promise((resolve, reject) => {
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
        .then(() => db.collection(config.db_files).findOne({clip_id: file.clip_id, property: "original", type: file.type}))
        .then(result => {
            if (!result) throw "Original file for " + file.filename + " is not available. Failed ffprobe";
            let path = require('path');
            let uri = path.posix.join(result.dirname, result.clip_id + result.extension);
            return {
                cmd: "ffprobe %(source)s",
                progress: "ffprobe",
                source: uri
            };
        })
    });
    actions.push({action: "rest_call", requisite: file => file.property !== "logging", critical: true, params: file => ({request: {
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
                    "value": new Buffer(JSON.stringify({
                        //"url": "https://s3." + params.region + ".amazonaws.com/" + params.bucket + "/" + file.filename,
                        "url": "https://" + params.bucket + ".s3.amazonaws.com/" + file.filename,
                        "assetName": file.asset_name,
                        "eventId": file.event_id,
                        "tcIn": file.results['ffprobe_metadata'].timecode,
                        "duration": file.results['ffprobe_metadata'].duration
                    })).toString("base64"),
                    "type": "binary"
                }
            }
        }
    }})});
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