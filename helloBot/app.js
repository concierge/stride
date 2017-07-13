var PORT = process.env.PORT;
var CLIENT_ID = process.env.CLIENT_ID;
var CLIENT_SECRET = process.env.CLIENT_SECRET;
var API_BASE_URL = 'https://api.stg.atlassian.com';

if (!PORT || !CLIENT_ID || !CLIENT_SECRET) {
  console.log ("Usage:");
  console.log("PORT=<http port> CLIENT_ID=<app client ID> CLIENT_SECRET=<app client secret> node.js");
  process.exit();
}

var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var request = require('request');
var app = express();
app.use(bodyParser.json());
app.use(express.static('.'));


function getAccessToken(callback) {
  var options = {
    uri: 'https://atlassian-account-stg.pus2.auth0.com/oauth/token',
    method: 'POST',
    json: {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      "audience": "api.stg.atlassian.com"
    }
  };
  request(options, function (err, response, body) {
    if (response.statusCode === 200 && body.access_token) {
      callback(null, body.access_token);
    } else {
      callback("could not generate access token: " + JSON.stringify(response));
    }
  });
}

function sendMessage(cloudId, conversationId, messageTxt, callback) {
  getAccessToken(function (err, accessToken) {
    if (err) {
      callback(err);
    } else {
      var uri = API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + '/message';
      var options = {
        uri: uri,
        method: 'POST',
        headers: {
          authorization: "Bearer " + accessToken,
          "cache-control": "no-cache"
        },
        json: {
          body: {
            version: 1,
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: messageTxt
                  }
                ]
              }
            ]
          }
        }
      }

      request(options, function (err, response, body) {
          callback(err, body);
      });
    }
  });
}

function sendReply(message, replyTxt, callback) {
  var cloudId = message.cloudId;
  var conversationId = message.conversation.id;
  var userId = message.sender.id;

  sendMessage(cloudId, conversationId, replyTxt, function (err, response) {
    if (err) {
      console.log ('Error sending message: ' + err);
      callback(err);
    } else {
      callback(null, response);
    }
  });
}


app.post('/installed',
    function (req, res) {
      console.log('app installed in a conversation');
      var cloudId = req.body.cloudId;
      var conversationId = req.body.resourceId;
      sendMessage(cloudId, conversationId, "Hi there! Thanks for adding me to this conversation. To see me in action, just mention me in a message", function(err, response){
        if(err)
          console.log(err);
      });
      res.sendStatus(204);
    }
);

app.post('/bot-mention',
    function (req, res) {
      console.log('bot mention');
      sendReply(req.body, "Hey, what's up? (Sorry, that's all I can do)", function (err, response) {
        if (err) {
          console.log(err);
          res.sendStatus(500);
        } else {
          res.sendStatus(204);
        }
      });
    }
);


http.createServer(app).listen(PORT, function () {
  console.log('App running on port ' + PORT);
});
