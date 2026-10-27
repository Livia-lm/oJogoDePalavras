const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = readFileSync(path.join(__dirname, "..", "prototipos.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class FakeElement {
  constructor({ id = "", dataset = {} } = {}) {
    this.id = id;
    this.dataset = { ...dataset };
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this._textContent = "";
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  dispatch(type, event = {}) {
    this.listeners[type]?.({ preventDefault() {}, ...event });
  }

  click() {
    this.dispatch("click");
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  append(...elements) {
    this.children.push(...elements);
  }

  prepend(element) {
    this.children.unshift(element);
  }

  replaceChildren(...elements) {
    this.children = [...elements];
  }

  querySelector(selector) {
    if (selector === "button[type='submit']") return this.submitButton;
    return null;
  }

  focus() {
    this.focused = true;
  }

  select() {
    this.selected = true;
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  get textContent() {
    return this._textContent;
  }
}

function createGame() {
  const ids = [
    "game-stage",
    "guess-form",
    "guess-input",
    "result-status",
    "attempt-list",
    "empty-state",
    "attempt-count",
    "score-value",
    "next-button",
    "give-up-button",
    "daily-mode",
    "practice-mode",
    "round-mode",
    "round-context",
    "concept-index",
    "concept-description",
    "visual-label"
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement({ id })]));
  const themes = ["atlas", "lab", "poster"].map((theme, index) =>
    new FakeElement({ dataset: { theme } })
  );
  const submitButton = new FakeElement();
  elements["guess-form"].submitButton = submitButton;
  elements["attempt-list"].children = [elements["empty-state"]];
  elements["attempt-count"].textContent = "0 palpites";
  elements["score-value"].textContent = "0";
  elements["daily-mode"].setAttribute("aria-pressed", "true");
  elements["practice-mode"].setAttribute("aria-pressed", "false");
  themes.forEach((tab, index) => tab.setAttribute("aria-pressed", String(index === 0)));

  const document = {
    querySelector(selector) {
      return elements[selector.slice(1)];
    },
    querySelectorAll(selector) {
      return selector === ".concept-tab" ? themes : [];
    },
    createElement() {
      return new FakeElement();
    }
  };
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0;
  vm.runInNewContext(script, { document, Math: deterministicMath });

  return { elements, themes, submitButton };
}

function submit(game, guess) {
  game.elements["guess-input"].value = guess;
  game.elements["guess-form"].dispatch("submit");
}

function latestAttempt(game) {
  return game.elements["attempt-list"].children[0];
}

test("valida entradas inválidas sem registrar tentativas", () => {
  const game = createGame();

  for (const guess of ["", "duas palavras", "palavra2", "!?"]) {
    submit(game, guess);
    assert.equal(game.elements["result-status"].dataset.state, "error");
    assert.equal(game.elements["attempt-count"].textContent, "0 palpites");
  }
});

test("classifica palpites e atualiza o histórico", () => {
  const game = createGame();

  submit(game, " livro ");
  assert.equal(latestAttempt(game).children[0].textContent, "livro");
  assert.equal(latestAttempt(game).dataset.distance, "near");
  assert.equal(latestAttempt(game).children[1].children[1].textContent, "Quente");
  assert.equal(game.elements["result-status"].textContent, "Seu palpite está quente da palavra.");

  submit(game, "escola");
  assert.equal(latestAttempt(game).dataset.distance, "mid");
  assert.equal(latestAttempt(game).children[1].children[1].textContent, "Morno");

  submit(game, "abacaxi");
  assert.equal(latestAttempt(game).dataset.distance, "far");
  assert.equal(latestAttempt(game).children[1].children[1].textContent, "Frio");
  assert.equal(game.elements["attempt-count"].textContent, "3 palpites");
});

test("rejeita repetição mesmo quando a grafia difere por acento ou caixa", () => {
  const game = createGame();

  submit(game, "MÚSICA");
  submit(game, "musica");

  assert.equal(game.elements["attempt-count"].textContent, "1 palpite");
  assert.equal(game.elements["result-status"].textContent, "Essa palavra já apareceu nesta rodada.");
});

test("aceita resposta sem diferença de caixa/acentos e encerra com faixa correta", () => {
  const game = createGame();

  submit(game, "  BIBLIOTECA  ");

  assert.equal(game.elements["result-status"].dataset.state, "win");
  assert.equal(game.elements["result-status"].textContent, "Você acertou: biblioteca.");
  assert.equal(latestAttempt(game).dataset.distance, "correct");
  assert.equal(latestAttempt(game).children[1].children[1].textContent, "Correto");
  assert.equal(game.elements["guess-input"].disabled, true);
  assert.equal(game.elements["next-button"].hidden, false);
  assert.equal(game.elements["score-value"].textContent, "1");
});

test("desistir revela a resposta e encerra a rodada", () => {
  const game = createGame();

  game.elements["give-up-button"].click();

  assert.equal(game.elements["result-status"].dataset.state, "revealed");
  assert.equal(game.elements["result-status"].textContent, "A palavra era: biblioteca.");
  assert.equal(game.elements["guess-input"].disabled, true);
  assert.equal(game.elements["give-up-button"].hidden, true);
  assert.equal(game.elements["next-button"].focused, true);
});

test("alternar temas preserva tentativas e atualiza o tema selecionado", () => {
  const game = createGame();

  submit(game, "livro");
  game.themes[1].click();

  assert.equal(game.elements["game-stage"].className, "game-stage theme-lab");
  assert.equal(game.elements["concept-index"].textContent, "Conceito 02 de 03");
  assert.equal(game.elements["visual-label"].textContent, "sinal de afinidade");
  assert.equal(game.themes[1].getAttribute("aria-pressed"), "true");
  assert.equal(game.themes[0].getAttribute("aria-pressed"), "false");
  assert.equal(game.elements["attempt-count"].textContent, "1 palpite");
});

test("treino permite nova rodada sem repetir a resposta anterior imediatamente", () => {
  const game = createGame();

  game.elements["practice-mode"].click();
  assert.equal(game.elements["round-mode"].textContent, "Treino livre");
  assert.equal(game.elements["practice-mode"].getAttribute("aria-pressed"), "true");
  submit(game, "cachorro");
  assert.equal(game.elements["result-status"].dataset.state, "win");
  assert.equal(game.elements["score-value"].textContent, "1");

  game.elements["next-button"].click();
  submit(game, "praia");

  assert.equal(game.elements["result-status"].dataset.state, "win");
  assert.equal(game.elements["score-value"].textContent, "2");
});
