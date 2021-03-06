// @flow
import {autoUpdater} from 'electron-updater'
import {net} from 'electron'
import forge from 'node-forge'
import {NotificationResult, notifier} from './DesktopNotifier.js'
import {lang} from './DesktopLocalizationProvider.js'
import {noOp} from "../api/common/utils/Utils"
import {conf} from './DesktopConfigHandler'

class ElectronUpdater {
	_interval: IntervalID;
	_pollingInterval: number;
	_pubKey: string;
	_logger = {
		info: (m: string, ...args: any) => console.log.apply(console, ["autoUpdater info:", m].concat(args)),
		debug: noOp,
		verbose: noOp,
		error: (m: string, ...args: any) => console.error.apply(console, ["autoUpdater error:", m].concat(args)),
		warn: noOp,
		silly: noOp
	};

	start() {
		const checkUpdateSignature = conf.get('checkUpdateSignature')
		const pubKeyUrl = conf.get("pubKeyUrl")
		autoUpdater.autoDownload = !checkUpdateSignature
		autoUpdater.logger = this._logger
		if (checkUpdateSignature) {
			this._trackPublicKey(pubKeyUrl)
			    .then((pubKey) => {
				    this._pubKey = pubKey
				    autoUpdater.on('update-available', updateInfo => {
					    this._stopPolling()
					    this._verifySignature(updateInfo)
				    })
				    this._startPolling()
			    })
			    .catch((e: Error) => {
				    this._logger.error("ElectronUpdater.start() failed,", e.message)
			    })
		} else {
			this._startPolling()
		}

		autoUpdater.on('update-downloaded', (info) => {
			this._stopPolling()
			notifier
				.showOneShot({
					title: lang.get('updateAvailable_label', {"{version}": info.version}),
					body: lang.get('clickToUpdate_msg'),
				})
				.then((res) => {
					if (res === NotificationResult.Click) {
						autoUpdater.quitAndInstall(false, true)
					}
				})
				.catch((e: Error) => this._logger.error("Notification failed,", e.message))
		})
	}

	_verifySignature = (updateInfo: UpdateInfo): void => {
		const hash = Buffer.from(updateInfo.sha512, 'base64').toString('binary')
		const signature = Buffer.from(updateInfo.signature, 'base64').toString('binary')
		const publicKey = forge.pki.publicKeyFromPem(this._pubKey)
		if (publicKey.verify(hash, signature)) {
			this._logger.info('Signature verification successful, downloading update')
			autoUpdater
				.downloadUpdate()
				.catch((e: Error) => this._logger.error("Update Download failed,", e.message))
		} else {
			this._logger.error('Signature verification failed, skipping update')
			this._stopPolling()
		}
	}

	_trackPublicKey = (url: string): Promise<string> => {
		if (!url.startsWith('https://')) {
			return Promise.reject(new Error("invalid URL"))
		}
		return this._requestFile(url)
		           .then((result) => {
			           if (!result.startsWith('-----BEGIN PUBLIC KEY-----')) {
				           const newUrl = result
					           .split(':NEWURL:')
					           .find(part => part.startsWith(' https://'))
				           if (newUrl === undefined) {
					           return Promise.reject('Could not find public key.')
				           }
				           return this._trackPublicKey(newUrl.trim())
			           } else {
				           return result
			           }
		           })
	}

	_requestFile = (url: string): Promise<string> => {
		let buf: Buffer = Buffer.alloc(0)
		return new Promise((resolve, reject) => {
			net.request(url)
			   .on('response', response => {
				   response.on('error', err => {
					   reject(err)
				   }).on('data', chunk => {
					   buf = Buffer.concat([buf, chunk])
				   }).on('end', () => {
					   resolve(buf.toString('utf-8'))
				   })
			   }).on('error', err => {
				reject(err)
			}).end()
		})
	}

	_startPolling() {
		if (this._interval) {
			return
		}
		this._pollingInterval = conf.get("pollingInterval")
			? conf.get("pollingInterval")
			: 1000000
		autoUpdater
			.checkForUpdates()
			.catch((e: Error) => this._logger.error("Update check failed,", e.message))

		this._interval = setInterval(() => {
			autoUpdater
				.checkForUpdates()
				.catch((e: Error) => this._logger.error("Update check failed,", e.message))
		}, this._pollingInterval)
	}

	_stopPolling() {
		if (this._interval) {
			clearInterval(this._interval)
		}
	}
}

export const updater = new ElectronUpdater()
