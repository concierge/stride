const PORT = process.env.PORT;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const API_BASE_URL = 'https://api.atlassian.com';

if (!PORT || !CLIENT_ID || !CLIENT_SECRET) {
  console.log ("Usage:");
  console.log("PORT=<http port> CLIENT_ID=<app client ID> CLIENT_SECRET=<app client secret> node app.js");
  process.exit();
}

const _ = require('lodash');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const request = require('request');
const app = express();
app.use(bodyParser.json());
app.use(express.static('.'));


function getAccessToken(callback) {
  const options = {
    uri: 'https://auth.atlassian.com/oauth/token',
    method: 'POST',
    json: {
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      "audience": "api.atlassian.com"
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
      const uri = API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + '/message';
      const options = {
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
  const cloudId = message.cloudId;
  const conversationId = message.conversation.id;
  const userId = message.sender.id;

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
      const cloudId = req.body.cloudId;
      const conversationId = req.body.resourceId;
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

/**
 * Don't worry about this for now.
 */
app.get('/descriptor', function (req, res) {
  fs.readFile('./app-descriptor.json', function (err, descriptorTemplate) {
    const template = _.template(descriptorTemplate);
    const descriptor = template({
      host: 'https://' + req.headers.host
    });
    res.set('Content-Type', 'application/json');
    res.send(descriptor);
  });
});

http.createServer(app).listen(PORT, function () {
  console.log('App running on port ' + PORT);
});
