let xml = require('libxmljs');
let sprintf = require('sprintf-js').sprintf;
let mongodb = require('mongodb');
let path = require('path');
let winston = require('winston');

module.exports = (params, config) => {
    let actions = [];
    let db;
    actions.push({id: "aspera_create_package", action: "rest_call", critical: true, params: file => new Promise((resolve, reject) => {
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
                result.path = result._id;
                sources.push(sprintf(source, result));
            }
            return {
                request: {
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
                            "title": file.type + " - " + (file.match_name || file.keywords || file.filename),
                            "note": file.keywords || file.filename,
                            "recipients": [params.recipient],
                            "send_upload_result": true,
                            "notify_on_upload": false,
                            "notify_on_download": false,
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
                }
            };
        })
    });
    actions.push({id: "aspera_query_package", action: "rest_call", requisite: () => params.check_package !== false, critical: true, params: file => {
        let url = file.results['aspera_create_package'];
        if (!url.hasOwnProperty("links") || !url.links.hasOwnProperty('status')) throw "Could not create aspera package";
        url = url.links.status;
        return {
            request: {
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
            }
        };
    }, loop_while: file => {
        try {
            let data = xml.parseXmlString(file.results["aspera_query_package"]).root();
            let metadata = {};
            let downloaded = false;
            let central_ids = [];

            metadata.package_id = data.get("//field[@name='_pkg_uuid']");
            if (metadata.package_id) metadata.package_id = metadata.package_id.text().trim();
            let download = data.get("//downloads/download");
            while (download) {
                let scope = download.get('scope');
                let status = download.get('status');
                let central_id = download.get('central_id');
                if (scope && status) {
                    if (scope.text().trim().toLowerCase() === "full" && status.text().trim().toLowerCase() === "completed") downloaded = true;
                    if (status.text().trim().toLowerCase() === "transferring" || status.text().trim().toLowerCase() === "completed") central_ids.push(central_id && central_id.text().trim() || "no_id");
                }
                download = download.nextElement();
            }
            if (downloaded && (central_ids.length > 1)) file.results['multiple_transfers'] = true;
            return !downloaded;
        }
        catch (e) {
            winston.error("Error parsing Aspera XML for file " + file.filename + ": ", e);
            return true;
        }
    }});
    actions.push({action: "wamp", params: {method: "publish", topic: "update_clip", xargs: file => ({clip_id: file.clip_id, type: file.type, event: "delivered", box: {name: params.destination_name}})}});
    actions.push({action: "email", requisite: file => file.results['multiple_transfers'], params: file => {
        return {
            body: "Multiple transfers detected from user " + params.recipient,
            recipient: "tech-digital-distrib@eurovision.net",
            subject: "Multiple transfers"
        }
    }});
    return actions;
};