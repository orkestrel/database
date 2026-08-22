# Frontend Design

> Part of the `enterprise-bootstrap` package. Full aesthetic, typography,
> process, and copy guidance — use when setting visual direction.
> Operate layer: [SKILL.md](../SKILL.md).

Give the surface a visual identity that could not be mistaken for anyone else's, and reject any
direction that reads as templated. Make deliberate, opinionated choices about palette, typography,
and layout that are specific to this brief, and take one real aesthetic risk you can justify.

## Ground it in the subject

Pin the subject before designing whenever the brief leaves it open: name one concrete subject, its
audience, and the page's single job, and state the choice. Use what you know of the user's
preferences, of what they are building, and of designs you have made for them before as hints, never
as templates. Draw the distinctive choices from the subject's own world — its materials,
instruments, artifacts, and vernacular. Build with the brief's real content and subject matter
throughout.

## Design principles

Open a web design's hero with the subject's thesis — the one claim the page makes — carried by the
most characteristic thing in the subject's world, in whatever form suits it: a headline, an image,
an animation, a live demo, an interactive moment. Choose that opening deliberately — a big number
with a small label, supporting stats, and a gradient accent is the template answer, so take it only
where it is genuinely the best option.

Set the typography as a decision rather than a default. Pair the display and body faces
deliberately, and not the families you would reach for on any other project. Set a clear type scale
with intentional weights, widths, and spacing. Make the type treatment one of the things the design
is remembered by.

Make every structural device — numbering, eyebrows, dividers, labels — encode something true about
the content rather than decorate it. Use numbered markers (01 / 02 / 03) only where the content is
a sequence: a real process, or a typed timeline whose order carries information the reader needs.
Before adding a device, check that it encodes something the reader needs.

Decide where and whether animation serves the subject: a page-load sequence, a scroll-triggered
reveal, hover micro-interactions, ambient atmosphere. Prefer one orchestrated moment to scattered
effects, and follow the direction where it calls for something else. Cut animation the direction
does not need — extra animation is one of the fastest ways to make a design read as AI-generated.

Match complexity to the vision. Maximalist directions need elaborate execution; minimal directions
need precision in spacing, type, and detail.

Write the copy yourself when the brief supplies none, and treat it as design material: templated
copy makes a surface read as templated as a templated layout does. Follow the writing rules below.

## Where the signature lives in product UI

Apply the same craft to dense, authenticated tools, and move the signature. In an admin screen or
dashboard the data is the content: keep it quiet, legible, and fast to scan, and never spend the
aesthetic risk on the table itself, which adds scan time for every user on every visit. Put the
point of view in the chrome — the navigation and header treatment, the type pairing, the empty
states, the handling of status and density. Make the frame impossible to mistake for another
product's, and keep the data surfaces disciplined and conventional enough to read without effort.

## Process: brainstorm, explore, plan, critique, build, critique again

Calibrate against the looks AI-generated design currently clusters around: (1) a warm cream
background (near #F4F1EA) with a high-contrast serif display and a terracotta accent; (2) a
near-black background with a single bright acid-green or vermilion accent; (3) a broadsheet-style
layout with hairline rules, zero border-radius, and dense newspaper-like columns. Each is
legitimate for some briefs; they are defaults rather than choices, and they appear regardless of
subject. Follow the brief exactly where it pins a visual direction — the brief's own words always
win, including when they ask for one of these looks. Where the brief leaves an axis free, spend that
freedom somewhere other than these defaults. Balance the moves you have already proven against
experimenting where the brief invites it.

Work in passes. First, brainstorm a short design plan from the brief: a compact token system
with color, type, layout, and signature. Color: describe the palette as 4–6 named hex values. Type:
name the typefaces for 2+ roles — a characterful display face used with restraint, a complementary
body face, and a utility face for captions or data where one is needed. Layout: state a layout
concept, using one-sentence prose descriptions and ASCII wireframes to ideate and compare.
Signature: name the single element this page will be remembered by, embodying the brief.

Then review that plan against the brief before building. Where a part of it reads like the generic
default you would produce for any similar page — work through a similar prompt and see whether you
arrive somewhere similar — revise that part, and say what you changed and why. Start writing code
only once the plan is specific to this brief, then follow the revised plan exactly and derive every
color and type decision from it.

Structure your CSS selector specificities deliberately when writing the code. Classes cancel each
other out easily, especially a type-based selector like `.section` against an element-based selector
like `.cta`, and the padding and margin between sections is where it happens most.

Do this planning and iteration in your thinking. Show the user a direction only once it satisfies
the brief and the quality floor below.

## Restraint and self-critique

Spend the boldness in one place. Let the signature element be the one memorable thing, keep
everything around it quiet and disciplined, and cut any decoration that does not serve the brief —
decorative emoji as UI, pill soup, glow effects, and gradient-on-everything are the usual instances
of decoration with no reason in the subject. Treat a surface with no deliberate risk as failing the
distinctiveness mandate. Meet the quality floor without announcing it: responsive down to mobile,
visible keyboard focus, reduced motion respected. Critique your own work as you build, and take
screenshots where the environment supports it. Read both themes and both the wide and the narrow
viewport from those captures, not the markup. Before shipping, remove one accessory: cut the
least-necessary decorative element, and restore it only where the surface demonstrably loses
information without it. Where notes persist across passes, record what you tried so the next pass
reads it.

## Writing in design

Keep a word only where it makes the design easier to understand, and therefore easier to use. Bring
the same intentionality to copy as to spacing and color. Before writing anything, decide what the
design needs to say, and how to say it so the person can navigate the experience.

Write from the end user's side of the screen. Name things by what people control and recognize,
never by how the system is built: a person manages notifications, not webhook config. Describe what
something does in plain terms rather than selling it, and choose the specific word over the clever
one.

Use the active voice by default. Make a control say exactly what happens when it is used: "Save
changes," not "Submit." Keep an action's name through the whole flow, so the button that says
"Publish" produces a toast that says "Published." Hold one vocabulary across every screen.

Give failure and emptiness direction rather than mood. State what went wrong and how to fix it, in
the interface's voice rather than a person's, without apology and without vagueness about what
happened. Name the action that fills an empty screen.

Keep the register conversational and tuned: plain verbs, sentence case, no filler, tone matched to
the brand and the audience. Give each element exactly one job: a label labels, an example
demonstrates, and nothing does double duty.

Keep a short control label unambiguous. Where the surrounding context already names the object, make
the visible label a single word and carry the specific phrase in the control's accessible name, so
nothing is lost for someone who arrives without that context.
