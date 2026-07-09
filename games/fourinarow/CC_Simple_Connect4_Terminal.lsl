// CC_Simple_Connect4_Terminal.lsl
// Simple Connect Four Terminal (No Lovense Integration)
// Configures Media-on-a-Prim and manages player role registration directly in Second Life.

string SERVER_URL = "http://YOUR_SERVER_URL_HERE"; // Update with your Node.js server URL (e.g. http://connect4-simple.alekzane.co.uk)
integer MOAP_FACE = 2; // Face number where the screen is displayed

integer DIALOG_CHAN = -29874;
integer gListen = 0;
key gUser = NULL_KEY;
key gHttpReq = NULL_KEY;
string gPendingRole = "";

default {
    state_entry() {
        string gameId = (string)llGetKey();
        string boardUrl = SERVER_URL + "/board/" + gameId;
        
        // Setup Media on a Prim (MOAP) with interaction disabled so clicks fall through to LSL touch
        llClearPrimMedia(MOAP_FACE);
        llSetPrimMediaParams(MOAP_FACE, [
            PRIM_MEDIA_CURRENT_URL, boardUrl,
            PRIM_MEDIA_HOME_URL, boardUrl,
            PRIM_MEDIA_AUTO_PLAY, TRUE,
            PRIM_MEDIA_CONTROLS, PRIM_MEDIA_CONTROLS_NONE,
            PRIM_MEDIA_PERMS_INTERACT, PRIM_MEDIA_PERM_NONE,
            PRIM_MEDIA_PERMS_CONTROL, PRIM_MEDIA_PERM_NONE
        ]);
        
        llSetClickAction(CLICK_ACTION_TOUCH);
        llSetText("🔴 CONNECT 4 ARCADE 🟡\nTouch to register or make a move", <0.0, 0.9, 1.0>, 1.0);
        llOwnerSay("[Connect 4] Terminal initialized. Board URL: " + boardUrl);
    }

    touch_start(integer total_number) {
        key toucher = llDetectedKey(0);
        integer face = llDetectedTouchFace(0);
        vector touchST = llDetectedTouchST(0);
        
        // Check if player clicked the board face
        if (face == MOAP_FACE && touchST != <-1.0, -1.0, 0.0>) {
            float s = touchST.x;
            integer col = (integer)(s * 7.0);
            if (col < 0) col = 0;
            else if (col > 6) col = 6;
            
            // Send move request to server using toucher's UUID
            string body = "gameId=" + (string)llGetKey() + 
                          "&uuid=" + (string)toucher + 
                          "&col=" + (string)col;
            
            gUser = toucher;
            gPendingRole = "";
            gHttpReq = llHTTPRequest(SERVER_URL + "/api/move", [
                HTTP_METHOD, "POST",
                HTTP_MIMETYPE, "application/x-www-form-urlencoded"
            ], body);
            return;
        }
        
        // Clicked outside the grid face - show registration/action dialog directly
        gUser = toucher;
        if (gListen) llListenRemove(gListen);
        gListen = llListen(DIALOG_CHAN, "", toucher, "");
        llSetTimerEvent(30.0);
        
        llDialog(toucher, "Welcome to Connect Four!\nChoose your slot to register and begin playing:", 
            ["Red Player", "Yellow Player", "Reset Game", "Cancel"], DIALOG_CHAN);
    }

    listen(integer channel, string name, key id, string message) {
        llSetTimerEvent(0.0);
        if (gListen) llListenRemove(gListen);
        gListen = 0;
        
        if (message == "Cancel") return;

        if (message == "Reset Game") {
            llSetText("🔴 CONNECT 4 ARCADE 🟡\nResetting board...", <1.0, 0.5, 0.0>, 1.0);
            
            gHttpReq = llHTTPRequest(SERVER_URL + "/api/reset", [
                HTTP_METHOD, "POST",
                HTTP_MIMETYPE, "application/x-www-form-urlencoded"
            ], "gameId=" + (string)llGetKey());
            
            llSetText("🔴 CONNECT 4 ARCADE 🟡\nTouch to register or make a move", <0.0, 0.9, 1.0>, 1.0);
            return;
        }

        string role = "";
        if (message == "Red Player") {
            role = "red";
        } else if (message == "Yellow Player") {
            role = "yellow";
        }

        if (role != "") {
            gPendingRole = role;
            string body = "gameId=" + (string)llGetKey() + 
                          "&uuid=" + (string)id + 
                          "&name=" + llEscapeURL(llKey2Name(id)) + 
                          "&role=" + role;
            
            gHttpReq = llHTTPRequest(SERVER_URL + "/api/join", [
                HTTP_METHOD, "POST",
                HTTP_MIMETYPE, "application/x-www-form-urlencoded"
            ], body);
        }
    }

    http_response(key request_id, integer status, list metadata, string body) {
        if (request_id != gHttpReq) return;
        gHttpReq = NULL_KEY;

        if (status == 400 || status == 404) {
            // Extract error message: {"error":"..."}
            integer errStart = llSubStringIndex(body, "\"error\":\"");
            if (errStart != -1) {
                string errMsg = llDeleteSubString(body, 0, errStart + 8);
                integer errEnd = llSubStringIndex(errMsg, "\"");
                if (errEnd != -1) {
                    errMsg = llDeleteSubString(errMsg, errEnd, -1);
                }
                
                // If they clicked but aren't registered yet, or game is inactive, open registration dialog
                if (errMsg == "Game is not active." || errMsg == "You are not a registered player in this game.") {
                    if (gListen) llListenRemove(gListen);
                    gListen = llListen(DIALOG_CHAN, "", gUser, "");
                    llSetTimerEvent(30.0);
                    llDialog(gUser, "Welcome to Connect Four!\nChoose your slot to register and begin playing:", 
                        ["Red Player", "Yellow Player", "Reset Game", "Cancel"], DIALOG_CHAN);
                } else {
                    llRegionSayTo(gUser, 0, "⚠️ " + errMsg);
                }
            } else {
                llRegionSayTo(gUser, 0, "⚠️ Error: " + body);
            }
            return;
        }

        if (status != 200) {
            llRegionSayTo(gUser, 0, "⚠️ Connection Error (Status " + (string)status + "): Server could not be reached.");
            return;
        }

        // Parse success JSON
        if (llSubStringIndex(body, "taken") != -1) {
            llRegionSayTo(gUser, 0, "❌ Error: The " + gPendingRole + " role is already taken by another player!");
        } else if (llSubStringIndex(body, "success\":true") != -1) {
            if (gPendingRole != "") {
                llRegionSayTo(gUser, 0, "✅ Registered successfully as " + gPendingRole + " Player!");
                gPendingRole = "";
            }
        }
    }

    timer() {
        llSetTimerEvent(0.0);
        if (gListen) llListenRemove(gListen);
        gListen = 0;
    }
}
