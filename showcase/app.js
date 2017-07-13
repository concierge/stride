var PORT = process.env.PORT;
var app = {};
app.clientId = process.env.CLIENT_ID;
app.clientSecret = process.env.CLIENT_SECRET;

if (!PORT || !app.clientId || !app.clientSecret) {
  console.log ("Usage:");
  console.log("PORT=<http port> CLIENT_ID=<app client ID> CLIENT_SECRET=<app client secret> node.js");
  process.exit();
}

var stride = require('./stride')(app);

var expressLib = require('express');
var bodyParser = require('body-parser');
var jwtUtil = require('jwt-simple');
var http = require('http');
var request = require('request');
var cors = require('cors');
var express = expressLib();
express.use(bodyParser.json());
express.use(expressLib.static('.'));

function validateJWT(req, res, next) {
  try {
    console.log('validating JWT: ' + JSON.stringify(req.headers));

    //Extract the JWT token
    var encodedJwt = req.query['signed_request']
        ||req.headers['authorization'].substring(4)
        ||req.headers['Authorization'].substring(4);

    // Decode the base64-encoded token, which contains the context of the call
    var jwt = jwtUtil.decode(encodedJwt, null, true);
    var conversationId = jwt.context.resourceId;
    var cloudId = jwt.context.cloudId;
    var userId = jwt.sub;

    // Validate the token signature using the installation's OAuth secret sent by HipChat during add-on installation
    // (to ensure the call comes from this HipChat installation)
    jwtUtil.decode(encodedJwt, app.clientSecret);

    //all good, it's from HipChat, add the context to a local variable
    res.locals.context = {cloudId: cloudId, conversationId: conversationId, userId: userId};

    // Continue with the rest of the call chain
    console.log('Valid JWT');
    next();
  } catch (err) {
    console.log('Invalid JWT');
    res.sendStatus(403);
  }
}

express.post('/installed',
    function (req, res) {
      console.log('app installed in a conversation');
      var cloudId = req.body.cloudId;
      var conversationId = req.body.resourceId;
      stride.sendMessage(cloudId, conversationId, "Hi there! Thanks for adding me to this conversation. To see me in action, just mention me in a message", function(err, response){
        if(err)
          console.log(err);
      });
      res.sendStatus(204);
    }
);

express.post('/bot-mention',
    function (req, res) {
      console.log('bot mention');
      stride.sendTextReply(req.body,  "Hey, what's up?", function (err, response) {
        if (err) {
          console.log(err);
          res.sendStatus(500);
        } else {
          res.sendStatus(204);
        }
      });
    }
);

express.get('/module/dialog',
    validateJWT,
    function (req, res) {
      res.redirect("/app-module-dialog.html");
    });

express.get('/module/glance/state',
    cors(),
    //validateJWT,
    function (req, res) {
      console.log("loading glance state")
      res.send(
          JSON.stringify({
            "label": {
              "value": "Click me!"
            }
          }));
    });

express.get('/module/sidebar',
    //validateJWT,
    function (req, res) {
      res.redirect("/app-module-sidebar.html");
    });

express.post('/ui/ping',
    validateJWT,
    function (req, res) {
      console.log('Received a call from the app frontend');
      var context = res.locals.context;
      stride.sendTextMessage(context.cloudId, context.conversationId, "Pong", function(err, response) {
        if(!err)
          res.send(JSON.stringify({status: "Pong"}));
        else
          res.send(JSON.stringify({status: "Failed"}));
      })

    }
);


http.createServer(express).listen(PORT, function () {
  console.log('App running on port ' + PORT);
});
