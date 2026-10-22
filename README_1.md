# MRE Halloween Carnival Volunteer Hub

One website for the whole volunteer season, every year.

- Families sign up through a Google Form.
- The front desk checks volunteers in and out on any phone, tablet, or laptop.
- Every check-in and check-out is time-stamped and saved.
- Each year gets its own form and spreadsheet. Past years stay saved.

**Everything is run from the website.** You never need to edit code, open GitHub, or touch any settings to run a new year.

---

## Part 1: For the person running the carnival

### The two passwords

| Password | Who gets it | What it unlocks |
|---|---|---|
| Front desk password | Front desk volunteers | Check-in and check-out only |
| Admin password | You (and a backup person) | Everything, including the **Admin** button |

Share passwords in person or by text. Never post them anywhere public.

### Signing in

1. Open the website: `https://profmanjumu.github.io/MRECarnivalVolunteerManagement/`
2. Type your name and the admin password.
3. Tap **Admin** in the top right corner. Tap **Back to check-in** to return.

### Each year: start the new carnival (about 2 minutes)

Do this a few weeks before the carnival, when you are ready to collect sign-ups.

1. Sign in with the admin password and tap **Admin**.
2. Find the box called **Start a new year**.
3. Check the **Event name**. It suggests the next year for you.
4. Type the **time slots**, one per line. For example:
   ```
   Sat 11:00am - 1:00pm
   Sat 1:00pm - 3:00pm
   Sat 3:00pm - 5:00pm
   ```
5. Type the **organizations**, one per line. This box is optional.
6. Leave both checkboxes checked:
   - **Reuse last year's form questions** keeps the same questions and wording.
   - **Stop last year's form from taking new sign-ups** closes the old form.
7. Tap **Create the new year** and wait up to a minute.
8. Tap **Copy sign-up link**. Paste it into your email, newsletter, or text to families.

That's it. The front desk switches to the new year automatically. The new form and spreadsheet are saved in Google Drive, in a folder called **MRE Carnival Volunteer Hub**.

### During sign-up season

| I want to... | Do this in Admin |
|---|---|
| Add, remove, or rename a time slot | Edit the **Time slots** box, then tap **Save to the form** |
| Add an organization | Edit the **Organizations** box, then tap **Save to the form** |
| See who has signed up | Tap **Open spreadsheet** |
| Change a question's wording | Tap **Edit form** and edit it in Google Forms |
| Stop taking sign-ups | Tap **Close sign-ups**. Tap **Reopen sign-ups** to undo |
| Fix a typo in someone's name | Tap **Open spreadsheet** and edit the cell |

Tip: rename time slots *before* people sign up. If you rename a slot after people picked it, their old answer still shows on the check-in screen, just with the old wording.

### On carnival day

- [ ] Give front desk volunteers the website link and the front desk password.
- [ ] Each person types their own name when signing in, so the log shows who checked whom in.
- [ ] Test one check-in on a fake **+ Walk-in**, then tap **Undo**.
- [ ] Keep devices charged and on Wi-Fi. The page needs internet to save.

### After the carnival: community service hours

1. In **Admin**, tap **Download hours (CSV)**.
2. Open the file in Excel or Google Sheets. It lists each volunteer's check-in, check-out, minutes, hours, and whether they asked for a signed receipt.

Past years are listed under **All events**. Each one has its own **Hours CSV** button.

### Already made your own Google Form?

Open **Use a form or sheet you already made** in Admin.

1. Open your form in Google Forms and copy the link from the address bar. It must end in `/edit`. The short "share" link will not work.
2. Paste it, give the event a name, and tap **Connect it**.
3. If the check-in list looks wrong afterward, open **Match the sheet columns** and pick which column holds each piece of information.

The form must belong to the Google account that runs this site.

### Changing passwords

Open **Passwords** in Admin. Anyone using the old password gets signed out within about 20 seconds. The front desk and admin passwords must be different.

### If something looks wrong

| What you see | Try this |
|---|---|
| A volunteer is missing from the list | Wait 20 seconds or reload. Check that they actually submitted the form. |
| Names show up wrong or blank | Admin > **Match the sheet columns** |
| "Wrong password" | Check with the admin. It may have been changed. |
| "No carnival is set up yet" | Admin > **Start a new year** |
| "Cannot reach the server" | Check the Wi-Fi. If Wi-Fi is fine, contact the tech helper (Part 2). |
| A red warning box in Admin | Read it. It says exactly what is wrong. |

---

## Part 2: For the tech helper (one-time setup and upgrades)

You only need this section once, or when upgrading the code.

### How it fits together

```
Google Forms (one per year)  -->  Google Sheets (one per year)
                                        |
                       Apps Script backend (Code.gs), one forever
                                        |
                  Website on GitHub Pages (index.html), one forever
```

- The website and the backend URL **never change** from year to year.
- The list of years lives in the backend's Script Properties (`HUB_CONFIG`). The Admin tab manages it. Never edit it by hand.
- Each year's sheet has two tabs: the form responses (read only to the script) and `CheckIns` (all timestamps).
- Everything belongs to one Google account. Handing off the carnival means handing off that account's login, so no files ever need to be moved.

### Installing or upgrading the backend

1. Go to [script.google.com](https://script.google.com) as the owner account and open the project.
2. Replace everything in `Code.gs` with the new version. Click **Save**.
3. **Project Settings > Script Properties.** Make sure these exist:
   | Property | Value |
   |---|---|
   | `FRONT_DESK_PASSWORD` | the front desk password |
   | `ADMIN_PASSWORD` | the admin password (must differ from the front desk one) |
   | `SHEET_ID` | only for the very first upgrade from the old single-sheet version. Leave it in place. |
   | `HUB_CONFIG` | created automatically. Do not edit. |
4. Back in the editor, choose `testSetup` from the function dropdown and click **Run**. Google asks for new permissions (Forms and Drive) because the hub creates forms and folders. Click **Advanced > Go to project** and **Allow**.
5. **Deploy > Manage deployments >** pencil icon **> Version: New version > Deploy.**

Never use **New deployment** for upgrades. It makes a new URL, and then `API_URL` in `index.html` would need changing too.

Deployment settings must stay: **Execute as: Me** and **Who has access: Anyone.** The password check protects the data.

### The website

`index.html` is on GitHub Pages. The only setting in it is near the bottom:

```js
const API_URL = 'https://script.google.com/macros/s/XXXX/exec';
```

### Debugging

- **"Cannot reach the server" or a CORS error in the browser console:** the backend crashed. CORS is a misleading symptom. In Apps Script, open **Executions** in the left sidebar and read the red error.
- **"Sorry, unable to open the file" when opening Apps Script:** you are signed into several Google accounts. Use an incognito window with only the owner account.
- **A permissions error after an upgrade:** run `testSetup` from the editor once to re-grant permissions, then redeploy a new version.

### How check-ins are matched

- Each card is keyed by name + organization + time slot.
- When the time slot question is a checkbox, a volunteer who picks two slots gets two cards. Each card checks in separately.
- Removing or editing a sign-up never deletes a check-in. Orphaned check-ins stay on screen tagged "not on roster."
- Timestamps come from Google's server in Pacific time.
- Email addresses are read by the backend but never sent to the website.
- The `Minutes` column in `CheckIns` feeds the hours export.
