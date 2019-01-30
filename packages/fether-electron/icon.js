// Copyright 2015-2018 Parity Technologies (UK) Ltd.
// This file is part of Parity.
//
// SPDX-License-Identifier: BSD-3-Clause

import path from 'path';
import url from 'url';

// const iconPath = url.format({
//   pathname: path.join(
//     __dirname.replace(/app\.asar$/, ''),
//     'Parity Fether.icns'
//   ),
//   protocol: 'file:',
//   slashes: true
// });
const iconPath = path.join(
  __dirname.replace(/app\.asar$/, ''),
  'build',
  'icon.png'
);

export { iconPath };
