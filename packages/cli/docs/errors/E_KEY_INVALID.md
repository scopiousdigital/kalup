# E_KEY_INVALID

The variable that holds a key has a value no request header can carry. Exit 1. Nothing was sent.

## When

Kalup sends the key in the `Authorization` header. A value with a line break, a carriage return, a NUL or another control character, or a character outside Latin-1, cannot go into a header, and the HTTP client would quote the whole value in its error. Kalup checks the value first, for the read key and the write key, from the process environment or from `.env`. The message names the variable and never the value.

This usually means the key was pasted across two lines, or with a stray character from a chat or a document.

## Fix

A person sets the variable again, with the key alone on one line, copied from HubSpot. Never paste the key into a chat, a log or a commit.

## Example

```
E_KEY_INVALID: The value of HUBSPOT_SANDBOX_KEY holds a line break or another character a request header cannot carry, so it was not sent. (fix: Set HUBSPOT_SANDBOX_KEY again with the key alone on one line, as HubSpot shows it.) (docs: errors/E_KEY_INVALID.md)
```
