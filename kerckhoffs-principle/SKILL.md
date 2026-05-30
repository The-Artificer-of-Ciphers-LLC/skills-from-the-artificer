---
name: kerckhoffs-principle
description: Apply Kerckhoffs's Principle when reviewing security designs, authentication systems, encryption implementations, or any situation where someone relies on keeping an algorithm, method, or system architecture secret for security. Trigger on phrases like "security through obscurity", "we keep the algorithm secret", "don't publish how this works", "our system is secure because nobody knows about it", or any security discussion where the secrecy of the design—rather than the secrecy of a key—is the security mechanism. This is a foundational principle of modern cryptography and security engineering.
---

# Kerckhoffs's Principle

> "In cryptography, a system should be secure even if everything about the system, except for a small piece of information — the key — is public knowledge."
> — Auguste Kerckhoffs, 1883

## The core idea

A secure system should remain secure even if your adversary knows everything about how it works — every algorithm, every protocol, every implementation detail. The only secret should be the **key**: a small, replaceable piece of information that is easy to change if compromised.

Equivalently (Claude Shannon's reformulation): "The enemy knows the system." Design accordingly.

## Why this matters

"Security through obscurity" — keeping the algorithm secret — is a fragile and dangerous strategy:

- **Algorithms leak.** Reverse engineering, insider threats, disgruntled employees, code dumps, patents, academic publications — secrets get out.
- **You can't change an algorithm like you can change a key.** If your secret is the algorithm and the algorithm leaks, you have to redesign your entire system. If your secret is a key and the key leaks, you rotate it.
- **Obscurity prevents scrutiny.** When experts can't examine your system, bugs and vulnerabilities go unfound. Open systems attract more eyeballs and become more secure over time (see also: Linus's Law).
- **Attackers don't follow your assumptions.** Designing under the assumption that attackers don't know your system design is almost always wrong by the time you're under attack.

## What this means in practice

**Use established, public cryptographic algorithms.**
AES, RSA, ChaCha20, bcrypt, Argon2 — these have been publicly scrutinized for decades. They're secure because they've been attacked extensively and held up. Don't build your own encryption. Don't use a "proprietary" cipher. Use the public standards.

**Put all your security into the key.**
The key is the secret. Protect it carefully. Make it long and random. Rotate it if compromised. The system design can be (and ideally should be) an open book.

**Don't treat system architecture as a security control.**
"Attackers won't know our API endpoints" is not a security model. "Attackers won't know our internal IP ranges" is not a firewall. These might slow down an attacker briefly, but they're not a substitute for actual security controls.

**Be skeptical of proprietary security claims.**
If a vendor says "our system is secure but we can't explain how it works," that's a red flag. Real security can be explained and verified.

**Security through obscurity as a layer — OK; as the foundation — not OK.**
Adding obscurity on top of a genuinely secure system (e.g., not publishing API endpoint paths, changing default ports) can have minor benefits. Using it as your primary defense is not acceptable.

## Key questions to surface

1. If an attacker fully understood how this system works — the algorithms, the code, the architecture — would it still be secure?
2. Are we relying on the adversary not knowing something about our design that could realistically become known?
3. If this "secret" leaked (disgruntled employee, breach, reverse engineering), how catastrophically would our security fail?
4. Are we using standard, peer-reviewed cryptographic algorithms, or something homegrown?
5. Where is the key, how is it protected, and how would we rotate it if compromised?

