module.exports = (params) => {
    let actions = [];
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    params.cmd = "ffprobe %(source)s";
    params.progress = "ffprobe";
    actions.push({id: "ffprobe_metadata", requisite: file => file.property === "original", action: "local", critical:true, params: params});
    actions.push({action: "rest_call", requisite: file => file.property === "original", critical: true, params: {request: file => ({
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
            })}});
    actions.push({id: "logging_contents", action: "read", requisite: file => file.property === "logging", critical: true, params: params});
    actions.push({action: "rest_call", requisite: file => file.property === "logging", critical: true, params: {request: file => ({
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
        })}});
    return actions;
};