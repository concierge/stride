var request = require('request');
var API_BASE_URL = 'https://api.stg.atlassian.com';
var API_AUDIENCE = "api.stg.atlassian.com";

module.exports = function(app) {

  function getAccessToken(callback) {
    var options = {
      uri: 'https://atlassian-account-stg.pus2.auth0.com/oauth/token',
      method: 'POST',
      json: {
        grant_type: "client_credentials",
        client_id: app.clientId,
        client_secret: app.clientSecret,
        "audience": API_AUDIENCE
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

  function sendMessage(cloudId, conversationId, messageBody, callback) {
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
            body: messageBody
          }
        }

        request(options, function (err, response, body) {
          callback(err, body);
        });
      }
    });
  }

  function sendUserMessage(token, cloudId, userId, message, callback) {
    var options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/user/' + userId + '/message',
      method: 'POST',
      headers: {
        authorization: "Bearer " + token,
        "cache-control": "no-cache"
      },
      json: {
        body: message
      }
    }
    request(options, function (err, response, body) {
      callback(err, body);
    });
  }

  function getConversation(token, cloudId, conversationId, callback) {
    var options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId,
      method: 'GET',
      headers: {
        authorization: "Bearer " + token,
        "cache-control": "no-cache"
      }
    }
    request(options, function (err, response, body) {
      callback(err, JSON.parse(body));
    });
  }

  function getUser(token, cloudId, userId, callback) {
    var options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/user/' + userId,
      method: 'GET',
      headers: {
        authorization: "Bearer " + token,
        "cache-control": "no-cache"
      }
    }
    request(options, function (err, response, body) {
      callback(err, JSON.parse(body));
    });
  }

  function createRoom(token, cloudId, name, privacy, topic, callback) {
    var body = {
      name: name,
      privacy: privacy,
      topic: topic
    }
    var options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation',
      method: 'POST',
      headers: {
        authorization: "Bearer " + token,
        "cache-control": "no-cache"
      },
      json: body
    }
    request(options, function (err, response, body) {
      callback(err, body);
    });
  }


  function archiveRoom(token, cloudId, conversationId, callback) {

    var options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + '/archive',
      method: 'PUT',
      headers: {
        authorization: "Bearer " + token,
        "cache-control": "no-cache"
      }
    }
    request(options, function (err, response, body) {
      callback(err, body);
    });
  }

  function getConversationHistory(token, cloudId, conversationId, callback) {
    var options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + "/message?limit=5",
      method: 'GET',
      headers: {
        authorization: "Bearer " + token,
        "cache-control": "no-cache"
      }
    }
    request(options, function (err, response, body) {
      callback(err, JSON.parse(body));
    });
  }

  function getConversationRoster(token, cloudId, conversationId, callback) {
    var options = {
      uri: API_BASE_URL + '/site/' + cloudId + '/conversation/' + conversationId + "/roster",
      method: 'GET',
      headers: {
        authorization: "Bearer " + token,
        "cache-control": "no-cache"
      }
    }
    request(options, function (err, response, body) {
      callback(err, JSON.parse(body));
    });
  }

  return {

    getAccessToken: getAccessToken,

    sendDocumentMessage: sendMessage,

    sendUserMessage: sendUserMessage,

    getConversation: getConversation,

    getUser: getUser,

    createRoom: createRoom,

    archiveRoom: archiveRoom,

    getConversationHistory: getConversationHistory,

    getConversationRoster: getConversationRoster,

    sendTextMessage: function (cloudId, conversationId, messageTxt, callback) {
      var message = {
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
      };
      sendMessage(cloudId, conversationId, message, callback);
    },

    sendDocumentReply: function (message, reply, callback) {
      var cloudId = message.cloudId;
      var conversationId = message.conversation.id;
      var userId = message.sender.id;

      sendMessage(cloudId, conversationId, reply, function (err, response) {
          callback(err, response);
      });
    },

    sendTextReply: function (message, replyTxt, callback) {
      var cloudId = message.cloudId;
      var conversationId = message.conversation.id;
      var userId = message.sender.id;

      var reply = {
        version: 1,
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: replyTxt
              }
            ]
          }
        ]
      };

      sendMessage(cloudId, conversationId, reply, function (err, response) {
          callback(err, response);
      });
    }
  }
};
