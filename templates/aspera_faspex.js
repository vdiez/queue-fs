let xml = require('libxmljs');
let sprintf = require('sprintf-js').sprintf;
let mongodb = require('mongodb');
let path = require('path');

module.exports = (params, config) => {
    let actions = [];
    let db;
    actions.push({id: "aspera_create_package", action: "rest_call", critical: true, params: {request: file => {
        return new Promise((resolve, reject) => {
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
        .then(() => db.collection(config.db_files).findOne({clip_id: file.clip_id, property: "metadata", type: file.type}))
        .then(result => {
            let source = params.source || "%(type)s/%(filename)s";
            let sources = [sprintf(source, file)];
            if (result && result.extension !== file.extension) {
                result.filename = result.clip_id + result.extension;
                result.file = path.posix.basename(result.filename);
                result.base_clip_id = path.posix.basename(result.clip_id);
                result.path = path.posix.join(result.dirname, result.filename);
                sources.push(sprintf(source, result));
            }
            return {
                url: params.host + "/aspera/faspex/send",
                method: 'POST',
                auth: {
                    user: params.username,
                    pass: params.password
                },
                strictSSL: false,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                json: {
                    "delivery": {
                        "title": file.type + " - " + (file.match_name || file.keywords || file.base_clip_id),
                        "note": file.keywords || file.base_clip_id,
                        "recipients": [params.recipient],
                        "send_upload_result": true,
                        "delete_after_download_policy": 2,
                        "use_encryption_at_rest": false,
                        "sources": [
                            {
                                "id": params.share_id,
                                "paths": sources
                            }
                        ]
                    }
                }
            };
        })
    }}});
    actions.push({id: "aspera_query_package", action: "rest_call", critical: true, params: {request: file => {
        let url = file.results['aspera_create_package'];
        if (!url.hasOwnProperty("links") || !url.links.hasOwnProperty('status')) throw "Could not create aspera package";
        url = url.links.status;
        return {
            url: url,
            method: 'GET',
            auth: {
                user: params.username,
                pass: params.password
            },
            headers: {
                'Accept': 'application/xml'
            },
            strictSSL: false
        };
    }}, loop_while: file => {
        try {
            let json = xml.parseXmlString(file.results["aspera_query_package"]).root();
            let metadata = {};

            let tmp = json.get("//field[@name='_pkg_uuid']");
            if (tmp) metadata.package_id = tmp.text().trim();
            tmp = json.get("//downloads");
            if (tmp) metadata.downloads = tmp.text().trim();
            return metadata.downloads;
        }
        catch (e) {
            winston.error("Error parsing Aspera XML for file " + file.filename + ": ", err)
            return true;
        }
    }});
    return actions;
};