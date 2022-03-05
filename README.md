# Exactly.finance Protocol v0.1

![CI Status](https://github.com/exactly-finance/protocol/actions/workflows/tests.yml/badge.svg)
[![codecov](https://codecov.io/gh/exactly-finance/protocol/branch/main/graph/badge.svg?token=qYngTpvXBT)](https://codecov.io/gh/exactly-finance/protocol)

## Clone

```bash
mkdir -p ~/dev/exactly && cd ~/dev/exactly
git clone git@github.com:exactly-finance/protocol.git
```

## Install Locally

```bash
npm install
```
also, run `npm run prepare` so git hooks are configured

## Add Environment Variables

Create an `.env`, using the example:

```
cp .env.example .env
```

You will then need to set the following keys there:

* `MNEMONIC`: a valid bip39 mnemonic from which accounts will be generated. To get a new one you can do it with `npx mnemonics`, taking into account that this mnemonic is only for development and testing.
* `RINKEBY_NODE`: RPC URL of an ethereum node to connect to rinkeby network
* `KOVAN_NODE`: RPC URL of an ethereum node to connect to kovan network
* `FORKING`: `true` if you want to work by forking a mainnet node
* `MAINNET_NODE`: RPC URL of an ethereum node to connect to main network
* `PUBLIC_ADDRESS`: where tokens will be sent so you can play around when in forking mode
* `AWS_USER_KEY=`(optional): For uploading addresses on deploy. To get the key you can ask @juanigallo for an AWS user
* `AWS_USER_SECRET=`(optional): For uploading addresses on deploy. To get the key you can ask @juanigallo for an AWS user

For the nodes you can create a free account in: `https://alchemyapi.io` and create both MAINNET and RINKEBY accounts. They have the upside of also being archive nodes so mainnet forking is possible

## Run Tests

```bash
npx hardhat test
```

## Run Coverage

```bash
npx hardhat coverage
```

## Gas Reports

```bash
export REPORT_GAS=1 && npx hardhat test
```

## Deploy

```bash
npx hardhat deploy --network rinkeby
```

## Docs

you can view them by:
- installing the dependencies with `poetry install -E docs`
- calling sphinx: `make singlehtml`
- opening it in `yourbrowser _build/singlehtml/index.html`

### LaTeX math
some of the math of the protocol is documented in the sphinx project, with help of `sphinx.ext.imgmath`

dependencies for this:
- [ ] dvipng
- [ ] texlive-latex-extra (or whatever provides utf8x.def in your latex installation)

resources:
- [ ] documentation of [sphinx.ext.imgmath](https://www.sphinx-doc.org/en/1.5.1/ext/math.html) (the thing that ends up invoking `pdflatex`). `.. math::` directive is spec'd there
- [ ] quick LaTex math refresher: https://en.wikibooks.org/wiki/LaTeX/Mathematics#Operators

### matplotlib plots

generated using good ol' matplotlib and numpy, with the help of `matplotlib.sphinxext`

resources
- [ ] [the integration with sphinx](https://matplotlib.org/sampledoc/extensions.html)
- [ ] [matplotlib](https://matplotlib.org/2.0.2/gallery.html)
