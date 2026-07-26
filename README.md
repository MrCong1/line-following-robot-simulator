# 3-Sensor Infrared Proximity Line-Following Robot Simulator

An interactive web simulator for a 3-sensor infrared proximity line-following robot. The simulator demonstrates how digital sensor states are converted into error values, PID correction, and left/right PWM motor outputs.

## Features

- 3 digital infrared proximity sensors: left, center, right
- Track options: infinity, circle, oval, and square
- Adjustable PID parameters: Kp, Ki, Kd
- Adjustable sampling time and base speed
- Live telemetry for error, P-term, I-term, D-term, correction, and PWM output
- Sensor truth table explaining how each sensor pattern affects robot motion
- High-Kp oscillation behavior to show zig-zag movement when proportional gain is too large
- Static export support for GitHub Pages

## Learning Goal

This project is intended for learning PID control through a line-following robot example. It helps students see the control flow:

```text
Infrared sensors -> sensor pattern -> error -> PID correction -> left/right PWM -> robot motion
```

## Sensor Pattern Table

| Pattern L-M-R | Meaning | Error | Robot action |
| --- | --- | --- | --- |
| `010` | Center sensor on line | `0` | Go straight |
| `110` | Line is slightly left | `-1.5` | Turn left gently |
| `100` | Line is far left | `-3` | Turn left strongly |
| `011` | Line is slightly right | `+1.5` | Turn right gently |
| `001` | Line is far right | `+3` | Turn right strongly |
| `111` | All sensors see line | `0` | Keep direction |
| `000` | Line lost | last side | Search using last direction |

## Tech Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- Canvas API

## Run Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build the static site:

```bash
npm run build
```

After building, Next.js creates the static output in the `out` folder.

## Deploy to GitHub Pages

This repository includes a GitHub Actions workflow:

```text
.github/workflows/pages.yml
```

To deploy:

1. Upload this project to a GitHub repository.
2. Go to `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. Go to the `Actions` tab.
5. Wait for `Deploy GitHub Pages` to finish successfully.

The site URL will look like:

```text
https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY_NAME/
```

## Project Structure

```text
src/
  app/
    globals.css
    layout.tsx
    page.tsx
  components/
    LineBotSimulator.tsx
public/
.github/
  workflows/
    pages.yml
next.config.ts
package.json
```

## Notes

- GitHub Pages can only host static files, so this project uses `output: "export"` in `next.config.ts`.
- Do not upload `node_modules`, `.next`, or `out` manually when using GitHub Actions.
- The simulator runs fully in the browser after deployment.
