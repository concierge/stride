var expressLib = require('express');
var bodyParser = require('body-parser');
var jwtUtil = require('jwt-simple');
var http = require('http');
var request = require('request');
var cors = require('cors');
var express = expressLib();
express.use(bodyParser.json());
express.use(bodyParser.urlencoded({
  extended: true
}));
express.use(expressLib.static('.'));

var PORT = process.env.PORT;
var app = {};
app.clientId = process.env.CLIENT_ID;
app.clientSecret = process.env.CLIENT_SECRET;

if (!PORT || !app.clientId || !app.clientSecret) {
  console.log ("Usage:");
  console.log("PORT=<http port> CLIENT_ID=<app client ID> CLIENT_SECRET=<app client secret> node.js");
  process.exit();
}

/**
 * Simple library that wraps the Stride REST API
 */
var stride = require('./stride')(app);

/**
 * This implementation doesn't make any assumption in terms of data store, frameworks used, etc.
 * It doesn't have proper persistence, everything is just stored in memory.
 */
var configStore = {};
var installationStore = {};

/**
 * Installation lifecycle
 * ----------------------
 * When a user installs or uninstalls your app in a conversation,
 * Stride makes a REST call to an endpoint specified in the app descriptor:
 *       "lifecycle": {
 *           "installed": "/some/url",
 *           "uninstalled": "/some/url"
 *       }
 * At installation, Stride sends the context of the installation: cloudId, conversationId, userId
 * You can store this information for later use.
 */
express.post('/installed',
    function (req, res) {
      console.log('app installed in a conversation');
      var cloudId = req.body.cloudId;
      var conversationId = req.body.resourceId;
      var userId = req.body.userId;

      //Store the installation details
      if(!installationStore[conversationId]) {
        installationStore[conversationId] = {
          cloudId: cloudId,
          conversationId: conversationId,
          installedBy: userId
        }
      }

      //Send a message to the conversation to announce the app is ready
      stride.sendMessage(cloudId, conversationId, "Hi there! Thanks for adding me to this conversation. To see me in action, just mention me in a message", function(err, response){
        if(err)
          console.log(err);
      });
      res.sendStatus(204);
    }
);

express.post('/uninstalled',
    function (req, res) {
      console.log('app uninstalled from a conversation');
      var cloudId = req.body.cloudId;
      var conversationId = req.body.resourceId;
      var userId = req.body.userId;

      //Remove the installation details
      installationStore[conversationId] = null;

      res.sendStatus(204);
    }
);

/**
 * Securing your app with JWT
 * --------------------------
 * Whenever Stride makes a call to your app (webhook, glance, sidebar, bot), it passes a JSON Web Token (JWT).
 * This token contains information about the context of the call (cloudId, conversationId, userId)
 * This token is signed, and you should validate the signature, which guarantees that the call really comes from Stride.
 * You validate the signature using the app's client secret.
 *
 * In this tutorial, the token validation is implemented as an Express middleware function which is executed
 * in the call chain for every request the app receives from Stride.
 * The function extracts the context of the call from the token and adds it to a local variable.
 */

function validateJWT(req, res, next) {
  try {
    console.log('validating JWT: ' + JSON.stringify(req.headers));

    //Extract the JWT token from the request header
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

    //all good, it's from Stride, add the context to a local variable
    res.locals.context = {cloudId: cloudId, conversationId: conversationId, userId: userId};

    // Continue with the rest of the call chain
    console.log('Valid JWT');
    next();
  } catch (err) {
    console.log('Invalid JWT');
    res.sendStatus(403);
  }
}

/**
 * chat:bot
 * --------
 * This function is called anytime a user mentions the bot in a conversation.
 * You first need to declare the bot in the app descriptor:
 * "chat:bot": [
 *   {
 *     "key": "refapp-bot",
 *     "mention": {
 *      "url": "https://740a1ad5.ngrok.io/bot-mention"
 *     }
 *   }
 * ]
 */

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

/**
 * chat:configuration
 * ------------------
 * Your app can expose a configuration page in a dialog inside the Stride app. You first declare it in the descriptor:
 * TBD
 */

express.get('/module/config',
    //validateJWT,
    function (req, res) {
      res.redirect("/app-module-config.html");
    });

// Get the configuration state from the configuration dialog
express.get('/module/config/state',
    validateJWT,
    function (req, res) {
      var conversationId = res.locals.context.conversationId;
      console.log("getting config state for conversation " + conversationId);
      var config = configStore[res.locals.context.conversationId];
      if (!config)
        config = {
          notificationLevel: "NONE"
        }
      res.send(JSON.stringify(config));
    });

// Save the configuration state from the configuration dialog
express.post('/module/config/state',
    validateJWT,
    function (req, res) {
      var conversationId = res.locals.context.conversationId;
      console.log("saving config state for conversation " + conversationId + ": " + JSON.stringify(req.body));
      configStore[conversationId] = req.body;
      res.sendStatus(204);
    });


express.get('/module/dialog',
    //validateJWT,
    function (req, res) {
      res.redirect("/app-module-dialog.html");
    });

/**
 * chat:glance
 * ------------
 * To contribute a chat:glance to the Stride right sidebar, declare it in the app descriptor
 *  "chat:glance": [
 * {
 *   "key": "refapp-glance",
 *  "name": {
 *     "value": "App Glance"
 *   },
 *   "icon": {
 *     "url": "/icon.png",
 *     "url@2x": "/icon.png"
 *   },
 *   "target": "refapp-sidebar",
 *   "queryUrl": "/module/glance/state"
 * }
 * ]
 * This adds a glance to the sidebar. When the user clicks on it, Stride opens the module whose key is specified in "target".
 *
 * When a user first opens a Stride conversation where the app is installed,
 * the Stride app makes a REST call to the queryURL to get the initial value for the glance.
 * You can then update the glance for a conversation at any time by making a REST call to Stride.
 * Stride will then make sure glances are updated for all connected Stride users.
 **/

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

function updateGlance() {
  //todo
}

/*
 * chat:sidebar
 * ------------
 * When a user clicks on the glance, Stride opens an iframe in the sidebar, and loads a page from your app,
 * from the URL specified in the app descriptor
 * 		"chat:sidebar": [
 * 		 {
 * 		    "key": "refapp-sidebar",
 * 		    "name": {
 * 		      "value": "App Sidebar"
 * 		    },
 * 		    "url": "/module/sidebar",
 * 		    "authentication": "jwt"
 * 		  }
 * 		]
 **/

express.get('/module/sidebar',
    //validateJWT,
    function (req, res) {
      res.redirect("/app-module-sidebar.html");
    });

/**
 * Making a call from the app front-end to the app back-end:
 * You can find the context for the request (cloudId, conversationId) in the JWT token
 */

express.post('/ui/ping',
    validateJWT,
    function (req, res) {
      console.log('Received a call from the app frontend ' + JSON.stringify(req.body));
      var cloudId = res.locals.context.cloudId;
      var conversationId = res.locals.context.conversationId;
      stride.sendTextMessage(cloudId, conversationId, "Pong", function(err, response) {
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
