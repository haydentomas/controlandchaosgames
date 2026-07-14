// Control & Chaos Second Life Cabinet
// Template for a MOAP-enabled arcade cabinet with a secure callback URL.
//
// Required manual edits:
// - set SERVER_URL to your public Node.js server
// - set CABINET_ID to the cabinet object's stable identifier
// - validate the face index used for MOAP on your prim linkset

string SERVER_URL = "https://play.controlandchaos.co.uk";
string CABINET_ID = "Cabinet_Alpha_01";
integer MOAP_FACE = 2;

key gRegisterRequest = NULL_KEY;
key gWebhookRequest = NULL_KEY;
key gSecureUrlRequest = NULL_KEY;
string gCallbackUrl = "";

string buildRegistrationBody(string callbackUrl)
{
    return "{\"cabinetId\":\"" + CABINET_ID + "\",\"callbackUrl\":\"" + callbackUrl + "\"}";
}

integer setCabinetScreen()
{
    string targetUrl = SERVER_URL + "/?mode=sl&cabinetId=" + CABINET_ID;

    llClearPrimMedia(MOAP_FACE);
    llSetPrimMediaParams(MOAP_FACE, [
        PRIM_MEDIA_CURRENT_URL, targetUrl,
        PRIM_MEDIA_HOME_URL, targetUrl,
        PRIM_MEDIA_CONTROLS, PRIM_MEDIA_CONTROLS_STANDARD,
        PRIM_MEDIA_PERMS_INTERACT, PRIM_MEDIA_PERM_ANYONE,
        PRIM_MEDIA_PERMS_CONTROL, PRIM_MEDIA_PERM_NONE
    ]);

    llOwnerSay("[SL Cabinet] MOAP set to " + targetUrl);
    return TRUE;
}

default
{
    state_entry()
    {
        llOwnerSay("[SL Cabinet] Requesting secure URL...");
        gSecureUrlRequest = llRequestSecureURL();
    }

    on_rez(integer start_param)
    {
        llResetScript();
    }

    http_request(key id, string method, string body)
    {
        if (id == gSecureUrlRequest)
        {
            if (method == URL_REQUEST_GRANTED)
            {
                gCallbackUrl = body;
                llOwnerSay("[SL Cabinet] Callback URL granted: " + gCallbackUrl);
                gRegisterRequest = llHTTPRequest(
                    SERVER_URL + "/api/sl/register",
                    [HTTP_METHOD, "POST", HTTP_MIMETYPE, "application/json"],
                    buildRegistrationBody(gCallbackUrl)
                );
                setCabinetScreen();
                return;
            }

            if (method == URL_REQUEST_DENIED)
            {
                llOwnerSay("[SL Cabinet] Secure URL denied by Second Life.");
                return;
            }
        }

        if (method == "POST")
        {
            llOwnerSay("[SL Cabinet] Webhook received: " + body);
            llHTTPResponse(id, 200, "{\"status\":\"ok\"}");
            return;
        }

        llHTTPResponse(id, 405, "{\"error\":\"method_not_allowed\"}");
    }

    http_response(key request_id, integer status, list metadata, string body)
    {
        if (request_id != gRegisterRequest) return;

        if (status == 200)
        {
            llOwnerSay("[SL Cabinet] Registration succeeded.");
        }
        else
        {
            llOwnerSay("[SL Cabinet] Registration failed (" + (string)status + "): " + body);
        }
    }
}
