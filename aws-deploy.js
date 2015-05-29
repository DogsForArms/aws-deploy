#! /usr/bin/env node

var Colors = require('colors'),
	Bacon = require('baconjs').Bacon,
	Progress = require('progress'),
	argv = require('minimist')(process.argv.slice(2)),
	util = require('util'),
	fs = require('fs'),
	AWS = require('aws-sdk'),
	path = require("path");

var s3 = require('s3');
var awsS3Client = new AWS.S3();
var options = {
  s3Client: awsS3Client,
};
var client = s3.createClient(options);




function exit(error){
	if (error){
		log(error.red.bold)
	}
	process.exit((error ? 1 : 0))
}
function log(){
	console.log.apply(this, Array.prototype.slice.call(arguments))
}
function vlog(){
	if (argv.v){
		console.log.apply(this, Array.prototype.slice.call(arguments))
	}
}
function getConfig(){

	return Bacon.fromCallback(function(_callback){

		var callback = function(config){
			vlog('initial config: ' + JSON.stringify(config, null, 4).blue )
			_callback(config)
		}
		var read = Bacon.fromNodeCallback(fs.readFile, './.aws-deploy');
		

		read.onError(function(error) { 
			
			if (error.errno === 34){
				callback({})
			} else 
			{
				vlog(' read ./.aws-deploy error: '.red.inverse.bold)
				exit(error.toString())			
			}

		});
		read.onValue(function(value) { 
			var configJson;
			try {
				configJson = JSON.parse(value)
			} catch (e){
				exit(e.toString() + 'The file "./.aws-deploy" is corrupted.  It must be a valid json.')
			}
			callback(configJson)

		});
	})
}


var UIPrompt = function(desc, def, key, validation){
	this.desc = desc 				//description
	this.def = def 	 				//default
	this.key = key
	this.validation = validation 	//validation Bacon
}

function promptUser(uip){

	return Bacon.fromCallback(function(callback){

		process.stdin.resume();
		process.stdin.setEncoding('utf8');

		var defaults = uip.def ? uip.def : ''
		var displayDefaults = defaults ? '('+defaults+')' : ''

		process.stdout.write(uip.desc.gray + displayDefaults +  ': '.gray)

		Bacon.fromEvent(process.stdin, 'data').onValue(function(text){
			
			text = text.split('\n')[0]
			if (text.length === 0){
				text = defaults
			}
			if (!uip.validation){
				callback(text)
			} else {
				uip.validation(text).onValue(function(value){
					if (value !== null){
						callback(value)
					} else {
						log(' Invalid '.red.bold.inverse)
						
						promptUser(uip).onValue(function(value){
							callback(value)
						})
					}
				})
			}
		})

	})
}

vlog('input: '  + JSON.stringify(argv, null, 4).italic.blue )

//process arguments
if (argv._[0] === 'init'){
	vlog('command: ' + 'init'.green)


	getConfig().onValue(function(config){

		var _inputs = [
			//ask for bucket name
			(new UIPrompt('Enter your bucket name ', config['Bucket'], 'Bucket')),
			
			//ask for aws path
			(new UIPrompt('Enter the desired s3 path ', config['Key'], 'Key', function(value){
				return Bacon.fromCallback(function(callback){
					callback( !value ? null :
						(value.split('/').
							filter(function(v){ return (v !== '') }).join('/')
							 + '/'))
				})	
			}))
		]

		var parseInitInputsThen = function(inputs, c){
			// log(inputs[0])
			if (!inputs[0]){ c(); return }
			promptUser(inputs[0]).onValue(function(value){
				config[inputs[0].key] = value
				parseInitInputsThen( inputs.slice(1), c )
			})
		}

		parseInitInputsThen(_inputs, 
			function(){
			//all done
			vlog('config: ' + JSON.stringify(config, null, 4).yellow)

			var write = Bacon.fromNodeCallback(fs.writeFile, './.aws-deploy', JSON.stringify(config, null, 4))
			write.onValue(function(res){
				log('Init complete, you can deploy with >aws-deploy deploy'.green)
				exit()
			})
			write.onError(function(err){
				exit('while writing ./.aws-deploy, there was an error: ' + error.toString())
			})

		})



	})

	// userInput('Enter your bucket\'s name').onValue(function(text){
	// 	console.log('yay: ' + text)
	// })

} else 
if (argv._[0] === 'deploy') {
	getConfig().onValue(function(config){
		if (config === {}){
			exit('First run >aws-deploy init')
		} else {

			

			var params = {
			  localDir: ".",
			  deleteRemoved: true, // default false, whether to remove s3 objects
			                       // that have no corresponding local file.

			  s3Params: {
			    Bucket: config.Bucket,
			    Prefix: config.Key,
			    // other options supported by putObject, except Body and ContentLength.
			    // See: http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#putObject-property
			  },
			};
			var uploader = client.uploadDir(params);
			uploader.on('error', function(err) {
			  console.error("unable to sync:", err.stack);
			  exit(err.toString())
			});
			uploader.on('progress', function() {
			  console.log("progress", uploader.progressAmount, uploader.progressTotal);
			});
			uploader.on('end', function() {
			  console.log("done uploading");
			});
		}
	})
} else {
	exit('There was no match for your command.')
}


