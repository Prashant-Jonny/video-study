
"use strict"

var async = require('neo-async');
var _     = require('lodash');
var exec  = require('child_process').exec;
var cv    = require('cloudcv-backend');
var fs    = require('fs');
var h     = require('highlander');

var AVStudy = function(options) {
	this.options = {
		path: '',
		timestamps: null,
		count: null,
		resolution: '1024x768',
		outputFolder: 'tmp',
		outputFormat: 't-%s.png',
		outputFile: 'output.json',
		port: 8080
	};
	_.extend(this.options, options);
	this.outstream = fs.createWriteStream(this.options.outputFile);
	this.log('Initializing video decoder');
	this.log('Study initialized with ' + this.options.path);
};

AVStudy.prototype.startProcessing = function() {
	async.waterfall([
		this.getFrameCount.bind(this),
		this.getScreenshots.bind(this),
		this.finish.bind(this)
	]);
};

AVStudy.prototype.log = function(msg, data) {
    console.log('- ' + msg);
    if (! _.isUndefined(data)) {
    	console.log(data);
    }
};

AVStudy.prototype.command = function(command, callback) {
    exec(command, callback);
};

AVStudy.prototype.getFrameCount = function(callback) {
	this.command(
		'ffprobe ' +
		' -i ' + this.options.path +
		' -show_format -v quiet | sed -n \'s/duration=//p\'',
		function(err, stdout, stderr) {
			if (err) {
				this.log('Error finding frames', err);
				return callback(err);
			}
			this.duration = parseInt(stdout);
			this.log('Total duration ' + this.duration);
			callback(null);
		}.bind(this)
	);
};

AVStudy.prototype.getScreenshots = function(callback) {
	var self = this;
	this.interval = 1;
    this.times = [];
    for (var i = 0; i <= this.duration; i = i + this.interval) {
    	this.times.push(Math.ceil(i));
    }
    async.mapLimit(
    	this.times,
    	5,
    	function(time, mapNext) {
    		fs.exists(
    			this.options.outputFolder + '/' +
    			'f' + time + '.png',
    			function(exists) {
    				if (exists) {
    					return self.processScreenshot(
							time,
							mapNext
						);
    				}
					self.getFrame(
			    		time,
			    		'f' + time + '.png',
			    		mapNext
			    	);
    			}
    		);
    	}.bind(this),
    	callback
    );
};

AVStudy.prototype.getFrame = function(time, output, callback) {
	var command = 'ffmpeg ' +
	    ' -ss ' + time + ' ' +
	    ' -i ' + this.options.path +
		' -vframes 1 -q:v 5 ' +
		' ' + this.options.outputFolder + '/' + output;
	this.command(
		command,
		function(err, stdout) {
			this.log('Processed frame ' + time);
			this.processScreenshot(
				time,
				callback
			);
		}.bind(this)
	);
};

AVStudy.prototype.processScreenshot = function(time, callback) {
	var self = this;
	var file =
		self.options.outputFolder + '/' +
		'f' + time + '.png';
	async.waterfall([
		function(next) {
			fs.exists(
				file,
				function(exists) {
					if (exists) {
						next(null);
					}
				}
			)
		},
		function(next) {
			fs.readFile(
				file,
				function(err, image) {
					if (err) {
						return next(err);
					}
					next(null, image);
				}
			);
		},
	    cv.analyzeImage,
		function(analyzeResult) {
		    var returnRes = [];
		    for (
		    	var i = 0;
		    	i < analyzeResult.dominantColors.length;
		    	i++
		    ) {
		        var c = analyzeResult.dominantColors[i];
		        returnRes.push({
		            red: c.average[0],
		            green: c.average[1],
		            blue: c.average[2],
		            html: c.html
		        });
		    }
    		self.log('Analyzed image ' + time);
		    self.outstream.write(
		    	JSON.stringify({
    		        'f': time,
    		        'r': returnRes
		    	}) + "\n"
		    );
		    self.socket.emit('frame', time, returnRes);
		    callback(null, returnRes);
		}
	]);
};

AVStudy.prototype.matchProcess = function() {
	this.log('Matching processed');
};

AVStudy.prototype.finish = function() {
	this.log('Finished processing');
};

var study = new AVStudy({
    path:         '/Volumes/ddibiase-tb/VideoStudy/WillyWonka/willywonka.mp4',
    outputFolder: '/Volumes/ddibiase-tb/VideoStudy/WillyWonka/frames',
    outputFile:   '/Volumes/ddibiase-tb/VideoStudy/WillyWonka/framedata.txt'
});

var app = require('express')();
var http = require('http').Server(app);
var socket = require('socket.io')(http);

study.socket = socket;

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});
socket.on('connection', function(socket) {
    console.log('Client is connected');
	socket.on('processVideo', function(msg) {
		console.log('Process request');
	    study.startProcessing();
	});
});

http.listen(8080, function() {
    console.log('Server connected');
});
