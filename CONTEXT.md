# T3 Code

A GUI that drives coding agents through provider CLIs. This glossary holds product and
provider-integration terms; orchestration vocabulary (command, decider, event, projector,
adapter, reactor, receipt, checkpoint) stays in `docs/internals/glossary.md`.

## Language

**Provider option**:
A per-thread choice that T3 Code persists with the thread and re-applies to the provider
session every time that session starts, such as reasoning effort or OhMyPi's advisor.
_Avoid_: model option, trait, session toggle

**Provider setting**:
Global configuration of a provider instance, such as its binary path or enabled state. It
applies to every thread that uses the instance.
_Avoid_: provider config, provider option

**Skill**:
A named instruction bundle the provider discovers on disk and the user starts with a
`$name` mention. How a provider runs it, such as OhMyPi's `/skill:name`, is not part of the term.
_Avoid_: skill command, slash skill
