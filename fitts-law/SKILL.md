---
name: fitts-law
description: Apply Fitts's Law whenever someone is designing or critiquing a user interface—button placement, click targets, menu design, touch UI, navigation, or any interactive element. Trigger on phrases like "where should I put this button?", "users are missing this control", "the click target feels small", "how should I design this menu?", or any UX/UI discussion about the effort required to interact with an element. Fitts's Law is one of the oldest and most empirically reliable principles in human-computer interaction.
---

# Fitts's Law

> "The time to acquire a target is a function of the distance to and the size of the target."
> — Paul Fitts, 1954

## The core idea

Fitts's Law says: the time it takes to move to and click (or tap) a target depends on two things:
1. **Distance** — how far away is the target from your starting position?
2. **Size** — how big is the target?

Big targets that are close are fast and easy to hit. Small targets that are far away are slow and error-prone. This sounds obvious, but its implications for interface design are profound and frequently ignored.

The mathematical form: `T = a + b * log2(2D/W)`
Where T = time, D = distance to target, W = width of target. You don't need to use the formula — just internalize the ratio: **bigger and closer is always better for targets users will interact with frequently.**

## Key design implications

**1. The edges and corners of screens are infinitely large (on desktop).**
On a mouse-driven interface, the cursor stops at the screen edge. So a button in the corner is effectively infinitely large in two directions — you can fling your cursor toward it at full speed without overshooting. This is why the Mac menu bar is at the top of the screen, and why the Windows Start button is in a corner. Use screen edges for your most common actions.

**2. Make interactive targets as large as reasonable.**
Tiny click targets — small icons, thin borders, small text links — force slow, precise movements. Buttons should be large enough to hit confidently, especially for primary actions.

**3. Put frequently used controls close to where users already are.**
Context menus appear right at the cursor. Toolbars close to the content. Mobile keyboards auto-complete near the thumb. Distance is the enemy of speed.

**4. On touch screens, finger targets need to be bigger than mouse targets.**
A finger is ~44px-48px in effective width; a cursor is 1px. Apple's HIG recommends touch targets of at least 44×44 points. Violating this causes frustrated tapping and missed targets.

**5. Related actions should be spatially close.**
If a user just clicked "Add to cart," the "Checkout" button should be nearby. Don't make them travel across the screen.

## Common mistakes Fitts's Law catches

- Delete/destructive buttons too close to safe buttons (risk of mis-taps)
- Primary CTA buried at the bottom with lots of scrolling
- Form submit buttons far from form fields
- Tiny close buttons (X) in notification toasts
- Navigation items too small or too spread out on mobile

## Key questions to surface

When reviewing an interface:
1. What are the most frequent user actions? Are those targets big and close?
2. Are any important interactive elements small, thin, or far from where the user's attention already is?
3. On mobile: can targets be hit confidently with a thumb? Are they at least 44px in height?
4. Are destructive and safe actions appropriately separated (to prevent accidental clicks)?
5. Am I taking advantage of screen edges for globally important controls?

