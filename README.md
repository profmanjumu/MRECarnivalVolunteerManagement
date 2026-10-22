# MRE Halloween Carnival Volunteer Check-In

A password-protected check-in page for the front desk. Volunteers sign up through a Google Form. The front desk checks them in and out on any phone, tablet, or laptop. Every check-in and check-out is time-stamped and saved to the Google Sheet.

This guide is written for whoever takes this over next. No coding experience needed for day-to-day use.

---

## 1. How the pieces fit together

There are three parts. Think of a restaurant.

| Part | Where it lives | Restaurant version |
|---|---|---|
| **The page** (`index.html`) | GitHub repo, published with GitHub Pages | The menu and the waiter. What people see and tap. |
| **The backend** (`Code.gs`) | A Google Apps Script project | The kitchen. Checks the password, reads the sheet, writes timestamps. |
| **The data** | The Google Sheet with the form responses | The pantry and the order log. |

```
Google Form  -->  Sheet tab "Form Responses 1"  (the roster, read only)
                         |
                  Apps Script (Code.gs)  <-->  Sheet tab "CheckIns" (timestamps)
                         |
              GitHub Pages page (index.html)  <--  front desk volunteers
```

Key rule: the script **only reads** the form responses tab. It **only writes** to the `CheckIns` tab. That is why new sign-ups can flow in at any time without touching anyone's check-in.

---

## 2. Links and owners (fill this in before handing off)

| Item | Link / value | Owner |
|---|---|---|
| Live check-in page | `https://profmanjumu.github.io/MRECarnivalVolunteerManagement/` | |
| GitHub repo | `https://github.com/profmanjumu/MRECarnivalVolunteerManagement` | |
| Google Sheet | | |
| Google Form | | |
| Apps Script project | | |
| Web app URL (ends in `/exec`) | | |
| Front desk password | Do not write it here. Share it in person or by text. | |

---

## 3. Updating the volunteer list (the sheet)

**Normal case: nothing to do.** New Google Form submissions land in `Form Responses 1`. The check-in page picks them up on its next refresh, which happens every 20 seconds.

**Fixing a typo or removing someone:** edit or delete their row in `Form Responses 1`.
- If they already checked in, their check-in is not lost. It stays on screen tagged "not on roster."
- Names are matched exactly (ignoring capitals and extra spaces), so a corrected spelling shows up as a fresh card.

**Adding someone by hand:** add a new row to `Form Responses 1`. Fill in at least the Name column. Or use the **+ Walk-in** button on the page during the event.

**The form must keep these columns** (wording can change slightly, the script looks for the key words):

| Column header | Used for |
|---|---|
| Name | Volunteer name (required) |
| What organization are you affiliated with? | Organization filter |
| What day/time are you available to volunteer? | Time slot |
| Grade | Shown on the card |
| Will you require a signed receipt of the community service hours you worked? | "Needs hours receipt" tag |
| Email Address | Read but never shown on the page |

**Using a new form or sheet next year:**
1. Copy the Sheet ID from the new sheet's URL. It is the long code between `/d/` and `/edit`.
2. In Apps Script, go to **Project Settings > Script Properties** and update `SHEET_ID`.
3. If the response tab has a different name, change `ROSTER_SHEET` at the top of `Code.gs`, then redeploy (section 6).
4. If any question wording changes a lot, update the matching line in `COLS` at the top of `Code.gs`.

**Do not edit the `CheckIns` tab during the event** unless you are fixing a mistake. If you do, never change the `Key` column. That is how the script matches each row to a volunteer.

---

## 4. Where the code lives

### The page: `index.html` on GitHub
1. Open the GitHub repo and click `index.html`.
2. Click the pencil icon to edit in the browser.
3. Click **Commit changes**. The live page updates in 1 to 2 minutes.

The only line most people ever need to change is near the bottom:
```js
const API_URL = 'https://script.google.com/macros/s/XXXX/exec';
```

### The backend: `Code.gs` in Apps Script
1. Go to [script.google.com](https://script.google.com) while signed in as the owner, or open the Sheet and choose **Extensions > Apps Script**.
2. Open the project. The code is in `Code.gs`.
3. After any edit, click **Save**, then **redeploy** (section 6). Saving alone does not update the live version.

A copy of `Code.gs` is kept in the GitHub repo as a backup. If you change the code in Apps Script, update the repo copy too.

---

## 5. Settings (Script Properties)

In Apps Script, go to **Project Settings** (gear icon) **> Script Properties**.

| Property | What it is |
|---|---|
| `FRONT_DESK_PASSWORD` | The password the front desk types to sign in |
| `SHEET_ID` | The ID of the Google Sheet with the form responses |

**To change the password:** edit the value and save. No redeploy is needed. Anyone currently signed in gets sent back to the login screen within about 20 seconds.

---

## 6. Redeploying after a code change

Only needed when `Code.gs` changes. Not needed for sheet edits or password changes.

1. In Apps Script, click **Deploy > Manage deployments**.
2. Click the pencil icon on the existing deployment.
3. Set **Version** to **New version**.
4. Click **Deploy**.

Always edit the existing deployment. Clicking **New deployment** creates a brand new URL, and then the page in GitHub would need its `API_URL` updated too.

Deployment settings must stay:
- **Execute as:** Me (the owner)
- **Who has access:** Anyone

---

## 7. Handing ownership to someone new

The new person needs access to all three parts.

1. **Google Sheet and Form:** Share > add them as **Editor**. To fully transfer, use Share > their name > **Transfer ownership**.
2. **Apps Script:**
   - If the script is attached to the Sheet, it comes along with the Sheet.
   - If it is a standalone project, open it at script.google.com and use **Share** to add them as Editor.
   - The deployment runs as whoever created it. If the original owner leaves, the new owner should create their own deployment (**Deploy > New deployment**, same settings as section 6), then update `API_URL` in `index.html`.
3. **GitHub:** Repo **Settings > Collaborators > Add people**. Or they can fork the repo and turn on Pages in their own account (**Settings > Pages > Deploy from branch > main**).
4. Give them the front desk password in person.

---

## 8. Event day checklist

- [ ] Open the live page on every front desk device and sign in.
- [ ] Do a test check-in and check-out on a fake walk-in, then undo it.
- [ ] Confirm the new row appears in the `CheckIns` tab.
- [ ] Keep devices charged and on Wi-Fi. The page needs internet to save.
- [ ] Each desk person types their own name at sign in, so the log shows who checked whom in.

**After the event:** the `CheckIns` tab is the official record. The `Minutes` column has exact time worked for community service hour receipts. Download it with **File > Download > CSV** to keep a copy.

---

## 9. Troubleshooting

| What you see | Most likely cause | Fix |
|---|---|---|
| "Cannot reach the server" or a CORS error in the browser console | The script is crashing. CORS is a misleading symptom. | In Apps Script, open **Executions** (left sidebar) and read the red error. Usually a missing Script Property or code that was saved but not redeployed. |
| "Wrong password" | Password typo or it was changed | Check `FRONT_DESK_PASSWORD` in Script Properties |
| "Set SHEET_ID in Script Properties" | Standalone script without a sheet ID | Add `SHEET_ID` (section 5) |
| "Roster tab not found" | Response tab was renamed | Match `ROSTER_SHEET` in `Code.gs` to the tab name, then redeploy |
| Apps Script shows "Sorry, unable to open the file" | Signed into multiple Google accounts | Use an incognito window signed into only the owner account |
| Extensions > Apps Script missing or broken | The sheet is an uploaded Excel file | **File > Save as Google Sheets** and use the new copy |
| New sign-ups not appearing | Page has not refreshed yet | Wait 20 seconds or reload the page |
| Old version of the page after a GitHub edit | Browser cache | Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows) |

---

## 10. How it works (for the curious)

- **Timestamps** come from Google's server in Pacific time, so a device with the wrong clock does not matter.
- **Each check-in is keyed** by name + organization + time slot. Someone with two separate sign-ups gets two separate check-ins.
- **Multiple desks** can work at the same time. The script locks the sheet for each write so two taps never collide.
- **Privacy:** the GitHub repo holds no volunteer data. Names load only after the password is verified, and email addresses are never sent to the page.
- **Undo** removes a check-out first, then a check-in. Undoing a walk-in's check-in removes the walk-in entirely.
