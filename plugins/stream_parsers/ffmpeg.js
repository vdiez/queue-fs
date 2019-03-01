module.exports = {
    parse(data) {
        if (data instanceof Buffer) {
            data = data.toString('utf8');
            if (stderr) this.data.stderr += data;
            else this.data.stderr += data;
        }
        let match_progress = data.match(/\W*time=\s*(\d+):(\d+):(\d+)\.\d+/);
        if (match_progress && this.data.total) {
            this.data.current = Number(match_progress[3]) + Number(match_progress[2]) * 60 + Number(match_progress[1]) * 3600;
            let percentage = Math.round(this.data.current * 100 / this.data.total);
            if (percentage != this.data.percentage) {
                this.data.percentage = percentage;
                if (this.publish) this.publish(this.data);
            }
        }
        let match_duration = data.match(/\W*Duration:\s*(\d+):(\d+):(\d+)\.\d+/);
        if (match_duration) this.data.total = Number(match_duration[3]) + Number(match_duration[2]) * 60 + Number(match_duration[1]) * 3600;
    }
};