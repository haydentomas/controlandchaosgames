// Control & Chaos Second Life Board
// Minimal MOAP board loader for an in-world prim.

string SERVER_URL = "https://play.controlandchaos.co.uk";
integer MOAP_FACE = 2;

default
{
    state_entry()
    {
        string gameId = (string)llGetKey();
        string boardUrl = SERVER_URL + "/?mode=sl&cabinetId=" + gameId;

        llClearPrimMedia(MOAP_FACE);
        llSetPrimMediaParams(MOAP_FACE, [
            PRIM_MEDIA_CURRENT_URL, boardUrl,
            PRIM_MEDIA_HOME_URL, boardUrl,
            PRIM_MEDIA_CONTROLS, PRIM_MEDIA_CONTROLS_STANDARD,
            PRIM_MEDIA_PERMS_INTERACT, PRIM_MEDIA_PERM_NONE,
            PRIM_MEDIA_PERMS_CONTROL, PRIM_MEDIA_PERM_NONE
        ]);

        llSetClickAction(CLICK_ACTION_TOUCH);
        llOwnerSay("[SL Board] MOAP set to " + boardUrl);
    }

    on_rez(integer start_param)
    {
        llResetScript();
    }
}
