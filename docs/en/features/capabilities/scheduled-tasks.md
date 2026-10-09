---
title: "Scheduled Tasks"
sidebar:
  order: 2
---

Set reminders for yourself or schedule recurring announcements without leaving chat.
Ask the bot directly, and she creates the schedule for you. Scheduled tasks belong to
the active persona.

Reminders notify the targeted user when they fire, while self-tasks are actions the
persona performs on its own at the scheduled time.

## Creating One

Tell her what to schedule in chat:

```text
remind me to submit the report at 14:30
every Friday at 8pm, post a reminder that game night is starting
```

She parses the requested time and recurrence. Reminders ping the target user when they
fire. Tasks are silent self-actions the persona carries out when the time comes.

## Timezones

Absolute times (such as "at 14:30" or "on Friday at 8pm") use the server's timezone
(`/config` > Behavior > General Behavior) by default. If you set your own timezone
with `/personal config`, the bot converts your local time automatically. "remind me at 9am"
means your 9:00 AM, even if the server is in another timezone. Relative times (such as
"in 2 hours") do not depend on timezones and are always safe.

When a reminder targets a user whose personal timezone differs from the server's, the
confirmation shows both clocks: the server time and the target's local time. If a time is
mislabeled, fix it with a follow-up message or `/scheduled-task edit`.

## Managing Tasks

Two slash commands let you review and adjust existing schedules:

- `/scheduled-task edit`: change a task's content, next trigger time, recurrence interval,
  or reminder target. Set the interval to `0` to make a recurring task one-time.
- `/scheduled-task remove`: delete a reminder or task.

Both commands open a picker listing your existing schedules by persona, time, channel,
and recurrence.

A server can hold up to 100 pending reminders and tasks at once. When it is full, TomoriBot
tells you instead of adding another; remove old ones with `/scheduled-task remove` to make room.

## How Delivery Works

Reminders are only marked complete after delivery succeeds. If delivery is interrupted,
TomoriBot automatically retries without altering the recurring schedule.

If delivery fails repeatedly and hits the retry limit, TomoriBot posts one warning with
the scheduled content and task ID. Failed user reminders ping the target so the reminder
is not missed, while failed self-tasks send no ping. One-time schedules are then removed,
while recurring schedules remain active for the next occurrence and can be managed with
`/scheduled-task edit` or `/scheduled-task remove`.

---

For more capabilities, see [Tools & Extensions](/features/capabilities/tools-and-extensions/).
