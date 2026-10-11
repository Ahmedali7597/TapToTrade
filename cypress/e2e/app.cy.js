// FE-01…FE-08 from Milestone 4 section 6.3. Each run registers a fresh fictional player.
const id = Date.now().toString(36);
const player = { email: `cy_${id}@example.test`, username: `cy_${id}`, password: `Cy-Test-${id}-7!`, city: "Hamilton, ON" };

/** Calls the API with the session's CSRF token (cookies are shared with the browser). */
const apiPost = (url, body) =>
  cy.request("/api/auth/me").then(({ body: me }) => cy.request({ method: "POST", url, body, headers: { "X-CSRF-Token": me.csrfToken } }));

describe("anonymous visitor", () => {
  it("FE-01 registration form renders all required fields", () => {
    cy.visit("/register");
    for (const label of ["Email", "Username", "Password", "City"]) cy.contains("label", new RegExp(`^${label}$`)).should("be.visible");
  });

  it("FE-02 successful registration redirects to the dashboard", () => {
    cy.visit("/register");
    cy.get("#email").type(player.email);
    cy.get("#username").type(player.username);
    cy.get("#password").type(player.password, { log: false });
    cy.get("#city").select(player.city);
    cy.contains("button", "Create account").click();
    cy.location("pathname").should("eq", "/dashboard");
    cy.contains("h1", `Hi, ${player.username}`);
  });

  it("FE-03 login form rejects empty fields", () => {
    cy.visit("/login");
    cy.contains("button", "Log in").click();
    cy.contains("Enter your email.").should("be.visible");
    cy.contains("Enter your password.").should("be.visible");
    cy.location("pathname").should("eq", "/login");
  });

  it("FE-06 unauthenticated visit to /inventory redirects to /login", () => {
    cy.visit("/inventory");
    cy.location("pathname").should("eq", "/login");
    cy.location("search").should("contain", "next=%2Finventory");
  });
});

describe("signed-in player", () => {
  beforeEach(() => apiPost("/api/auth/login", { email: player.email, password: player.password }));

  it("FE-04 card search returns results", () => {
    cy.visit("/search");
    cy.get("#name").type("Black Lotus");
    cy.contains("button", "Search").click();
    cy.get("[data-testid=search-results]").should("contain", "Black Lotus");
  });

  it("FE-05 a card from another player shows the Send request button", () => {
    cy.visit("/search?name=Black%20Lotus");
    cy.get("[data-testid=search-results] li").first().within(() => {
      cy.contains("a", "Send request").should("have.attr", "href").and("match", /^\/trades\/new\?to=/);
    });
  });

  it("FE-07 an added card appears in the inventory list", () => {
    cy.visit("/inventory");
    cy.get("#q").type("Counterspell");
    cy.contains("button", "Find").click();
    cy.contains("legend", "Choose a printing");
    cy.get("label:has(input[name=printingId])").first().click();
    cy.get("#quantity").clear().type("3");
    cy.contains("button", "Add to inventory").click();
    cy.get("[data-testid=inventory-list]").should("contain", "Counterspell");
  });

  it("FE-08 the trade inbox shows sent and received tabs", () => {
    cy.visit("/trades");
    cy.contains("[role=tab]", "Received").should("be.visible");
    cy.contains("[role=tab]", "Sent").click();
    cy.contains("You haven't sent any proposals yet.");
  });
});
