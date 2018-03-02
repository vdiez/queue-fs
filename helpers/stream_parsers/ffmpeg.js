module.exports = {
    progress: {current: 0, total: undefined},
    parse(data) {
        if (data instanceof Buffer) data = data.toString('utf8');
        let match_progress = data.match(/\W*time=\s*(\d+):(\d+):(\d+)\.\d+/);
        if (match_progress && this.progress.total) {
            this.progress.current = Number(match_progress[3]) + Number(match_progress[2]) * 60 + Number(match_progress[1]) * 3600;
            let percentage = Math.round(this.progress.current * 100 / this.progress.total);
            if (percentage != this.progress.percentage) {
                this.progress.percentage = percentage;
                if (this.publish) this.publish(this.progress);
            }
        }
        let match_duration = data.match(/\W*Duration:\s*(\d+):(\d+):(\d+)\.\d+/);
        if (match_duration) this.progress.total = Number(match_duration[3]) + Number(match_duration[2]) * 60 + Number(match_duration[1]) * 3600;
    }
};