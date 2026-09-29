# Rare Rush Sound Studio

Local listening page for the original game soundtrack and synthesized effects. This tool is excluded from production deployments.

Use Node 22.18+, the repository's installed dependencies, Google Chrome, and the `zip` command:

```sh
npm run audio:export
npm run audio:studio
```

Open http://127.0.0.1:4238/. Exporting all tracks can take several minutes. Outputs go to ignored `output/audio/rare-rush-8bit/`: three stereo WAV listening mixes, sixteen WAV effects, and a ZIP download. Pass the same optional output directory to both commands with `-- /path/to/audio` to use another location. `PORT` changes the local server port.

The live mixer uses the same score and synth as the game. It lets you audition each pace, world, direction, and effect. Downloaded tracks are arranged listening mixes; actual game audio responds to gameplay. Downloaded effects use NORMAL's key; live effects follow the selected mode.

The game starts silent with separate MUSIC and SFX controls. Preferences persist in that browser. Runs Feed previews, replay viewers, and headless agents stay silent.

Audio source is in `games/rare-rush/audio/`: `score.ts` contains compositions and cues, `synth.ts` renders them with Web Audio, and `run-audio.ts` observes run state without changing game physics, inputs, random generation, or rewards.

Validation:

```sh
npm run test:audio
npm run build
npm run test:audio:browser
```
