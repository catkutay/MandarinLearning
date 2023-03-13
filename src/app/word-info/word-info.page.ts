import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import Player from '../utils/player/player';
import {
  getStorage,
  ref,
  listAll,
  list,
  getDownloadURL,
} from '@firebase/storage';
import { firebaseApp } from 'src/config/firebase';
import { baseName, toStdNameTag } from '../utils/file';
import Recorder from 'js-audio-recorder';
import { sleep } from '../utils/utils';
import { DomSanitizer } from '@angular/platform-browser';
import { encodeWAV } from '../utils/transform/transform';
import { AppNet } from '../app.net';
import { PageBase } from '../app.page';
import { LoadingController, NavController } from '@ionic/angular';
import { AppStore } from '../app.store';
import {
  getFirestore,
  getDocs,
  collection,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  deleteDoc,
} from '@firebase/firestore';
import { AppUtil } from '../app.util';
import { AppConfig } from '../app.config';

let recorder = null;
let playTimer = null;
let oCanvas = null;
let ctx = null;
let drawRecordId = null;
let pCanvas = null;
let pCtx = null;
let drawPlayId = null;

@Component({
  selector: 'app-word-info',
  templateUrl: './word-info.page.html',
  styleUrls: ['./word-info.page.scss'],
})
export class WordInfoPage extends PageBase implements OnInit {
  item: any;
  itemFileName = '';
  itemUrl: any;
  player: HTMLAudioElement;
  isManfang = false;
  isPlay = true;
  state = {
    sampleBit: 16,
    sampleRate: 16000,
    numChannel: 1,
    compiling: false,
    isRecording: false, // 是否正在录音
    duration: 0,
    fileSize: 0,
    vol: 0,
  };

  loadingWin;
  audioList = [];

  inFavoriteStatus = false;

  constructor(
    private activeRoute: ActivatedRoute,
    protected appStore: AppStore,
    protected navCtrl: NavController,
    public route: ActivatedRoute,
    protected loadingCtrl: LoadingController,
    private sanitizer: DomSanitizer
  ) {
    super(appStore, navCtrl, route);
  }

  ngOnInit() {
    this.item = this.activeRoute.snapshot.params;
    if (!this.item) {
      return;
    }

    const content = this.item.Literal
      ? this.item.Literal
      : this.item.Translation;
    this.itemFileName = toStdNameTag(content);
    console.log(this.item);
    console.log(this.itemFileName);

    this.loadData();
    // this.componentDidMount();
    this.getList();
  }

  json(v) {
    return JSON.stringify(v, null, ' ');
  }
  setState(v: any) {}

  changeSampleRate(e, params) {
    this.setState({
      sampleRate: params.value,
    });
  }
  changeSampleBit(e, params) {
    this.setState({
      sampleBit: params.value,
    });
  }
  changeNumChannel(e, params) {
    this.setState({
      numChannel: params.value,
    });
  }
  changeCompile(e, { checked }) {
    this.setState({
      compiling: checked,
    });
  }

  modifyOption() {
    if (recorder) {
      const config = this.collectData();

      recorder.setOption(config);

      recorder = null;
    }
  }
  collectData() {
    return {
      sampleBits: this.state.sampleBit,
      sampleRate: this.state.sampleRate,
      numChannels: this.state.numChannel,
      compiling: this.state.compiling, // 是否开启边录音边转化（后期改用web worker）
    };
  }

  async loadData() {
    if (!this.item) {
      return;
    }

    this.inFavoriteStatus = await this.inFavorite();

    if (this.item.FileUrl) {
      this.itemUrl = this.sanitize(this.item.FileUrl);
      return;
    }

    const storage = getStorage(
      firebaseApp,
      'gs://mandaringathering-d91d4.appspot.com/'
    );

    const listRef = ref(storage, 'audio_data');
    const res = await listAll(listRef);
    res.prefixes.forEach((folderRef) => {
      console.log('dir: ', folderRef);
    });

    let item: any = null;
    res.items.forEach((itemRef) => {
      // console.log('file: ', itemRef);
      let name = baseName(itemRef.name);
      name = toStdNameTag(name);

      if (name == this.itemFileName) {
        item = itemRef;
      }
    });

    if (!item) {
      return;
    }

    const url = await getDownloadURL(item);
    this.itemUrl = url;
    console.log('url', this.itemUrl);
  }

  sanitize(url: string) {
    return this.sanitizer.bypassSecurityTrustUrl(url);
  }

  manfang() {
    this.isManfang = !this.isManfang;
    if (this.isManfang) {
      this.player.playbackRate = 0.5;
    } else {
      this.player.playbackRate = 1;
    }
    console.log(111);
    console.log(this.player.playbackRate);
  }

  // 录音开启
  startRecord() {
    this.clearPlay();

    const config = this.collectData();

    if (!recorder) {
      recorder = new Recorder(config);

      recorder.onprocess = function (duration) {
        // this.setState({
        //     duration: duration.toFixed(5),
        // });
        // 推荐使用 onprogress
      };

      recorder.onprogress = (params: any) => {
        // console.log(recorder.duration);
        // console.log(recorder.fileSize);

        this.setState({
          duration: params.duration.toFixed(5),
          fileSize: params.fileSize,
          vol: params.vol.toFixed(2),
        });
        // 此处控制数据的收集频率
        if (config.compiling) {
          console.log('音频总数据：', params.data);
        }
      };

      recorder.onplay = () => {};
      recorder.onpauseplay = () => {};
      recorder.onresumeplay = () => {};
      recorder.onstopplay = () => {};
      recorder.onplayend = () => {
        this.stopDrawPlay();
      };

      config.compiling &&
        (playTimer = setInterval(() => {
          if (!recorder) {
            return;
          }

          let newData = recorder.getNextData();
          if (!newData.length) {
            return;
          }
          let byteLength = newData[0].byteLength;
          let buffer = new ArrayBuffer(newData.length * byteLength);
          let dataView = new DataView(buffer);

          // 数据合并
          for (let i = 0, iLen = newData.length; i < iLen; ++i) {
            for (let j = 0, jLen = newData[i].byteLength; j < jLen; ++j) {
              dataView.setInt8(i * byteLength + j, newData[i].getInt8(j));
            }
          }

          let a = encodeWAV(
            dataView,
            config.sampleRate,
            config.sampleRate,
            config.numChannels,
            config.sampleBits
          );
          let blob: any = new Blob([a], { type: 'audio/wav' });

          blob.arrayBuffer().then((arraybuffer) => {
            Player.play(arraybuffer);
          });
        }, 3000));
    } else {
      recorder.stop();
    }
    this.state.isRecording = true;
    recorder.start().then(
      () => {
        console.log('开始录音');
      },
      (error) => {
        console.log(`异常了,${error.name}:${error.message}`);
      }
    );
  }

  // stop
  pauseRecord() {
    if (recorder) {
      recorder.pause();
      console.log('暂停录音');
      drawRecordId && cancelAnimationFrame(drawRecordId);
      drawRecordId = null;
    }
  }
  //stop recording
  async endRecord() {
    recorder && recorder.stop();
    
    drawRecordId && cancelAnimationFrame(drawRecordId);
    drawRecordId = null;
    this.state.isRecording = false;
    console.log('end recording');

    await this.saveRecord();
    console.log('保存完成');

    this.clearPlay();
   
  }

  playRecord() {
    recorder && recorder.play();
    drawRecordId && cancelAnimationFrame(drawRecordId);
    drawRecordId = null;
    // recorder && this.drawPlay();
    // setInterval(() => {
    //     recorder.getPlayTime()
    // }, 500)
  }
  clearPlay() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    if (drawRecordId) {
      cancelAnimationFrame(drawRecordId);
      drawRecordId = null;
    }
    this.stopDrawPlay();
  }
  stopDrawPlay = () => {
    drawPlayId && cancelAnimationFrame(drawPlayId);
    drawPlayId = null;
  };
  componentDidMount() {
    oCanvas = document.getElementById('canvas');
    ctx = oCanvas.getContext('2d');
    pCanvas = document.getElementById('playChart');
    pCtx = pCanvas.getContext('2d');
  }

  async getList() {
    if (!this.item) {
      return;
    }

    this.loadingWin = await this.loadingCtrl.create({
      message: 'data loading ...',
      showBackdrop: true,
      duration: 120000,
    });
    this.loadingWin.present();

    const db = getFirestore(firebaseApp);
    const colRef = collection(db, 'audioList');

    // Create a query against the collection.
    const wordId = '' + AppConfig.getUid() + '@@' + (this.item.id ?? '-1');
    console.log('WordId == ', wordId);
    const q = query(colRef, where('WordId', '==', wordId));

    const querySnapshot = await getDocs(q);
    const arr = [];

    querySnapshot.forEach((doc) => {
      console.log(
        `${doc.id} => `,
        AppUtil.xstrMid(JSON.stringify(doc.data()), 80, 40)
      );
      const ditem = doc.data();
      if (!ditem.id) {
        ditem.id = doc.id + 1;
      }
      if (ditem.FileUrl) {
        ditem.FileUrl = this.sanitize(ditem.FileUrl);
      }
      arr.unshift(ditem);
    });
    this.audioList = arr;

    this.loadingWin.dismiss();
  }

  saveRecord(): Promise<any> {
    return new Promise<any>((rel, rej) => {
      const wavBlob = recorder.getWAVBlob();
      const a = new FileReader();
      a.onload = async (e) => {
        if (e.target.result) {
          const str = e.target.result.toString();
          await this.doSaveRecord(str);
          console.log(str.length, AppUtil.xstrMid(str, 15, 10));
        }
        rel(true);
      };
      a.readAsDataURL(wavBlob);
    });

  }

  async doSaveRecord(fileUrl: string) {
    const loading = await this.loadingCtrl.create();

    const db = getFirestore(firebaseApp);
    const querySnapshot = await getDocs(collection(db, 'audioList'));
    let id = 0;
    let ids = [];
    let wordIdPrex = AppConfig.getUid() + '@@';
    querySnapshot.forEach((doc) => {
      let did = Number(doc.id);
      let wordId = doc.data()?.WordId ?? '';
      if (wordId.indexOf(wordIdPrex) === 0) {
        ids.push(did);
      }
      id = Math.max(id, isNaN(did) ? 0 : did);
    });

    // remove items
    ids.sort((a, b) => a - b);
    const remainAmount = 2; // only keep item amount // ids.length - 1;
    while (ids.length > remainAmount) {
      const eid = ids.shift();
      console.log('eid', eid);
      await deleteDoc(doc(db, 'audioList', '' + eid));
    }

    id++;
    console.log(id, id);
    setDoc(doc(db, 'audioList', '' + id), {
      id: '' + id,
      WordId: wordIdPrex + this.item.id,
      FileUrl: fileUrl,
    }).then(
      () => {
        loading.dismiss();
        this.getList();
      },
      (error) => {
        loading.dismiss().then(() => {
          console.error(error);
        });
      }
    );

    await loading.present();
  }

  ccc() {
    let a = 0;
    this.player = document.getElementById('audio_player') as HTMLAudioElement;
    let b = document.getElementById('bgc');
    this.isPlay = !this.player.paused;
    function ab(ev) {
      this.isPlay = this.player.paused;
      b.style.width = 0 + 'px';
      ev.stopPropagation();
    }
    function aa(e) {
      a = (this.player.currentTime / this.player.duration) * 100;
      b.style.width = a + '%';
      e.stopPropagation();
    }
    this.player.addEventListener('ended', ab.bind(this), false);
    this.player.addEventListener('timeupdate', aa.bind(this), false);

    if (this.player.paused) {
      this.player.play();
    } else {
      this.player.pause();
    }
  }
  listPlay(id) {
    let a = 0;
    let player = document.getElementById(id) as HTMLAudioElement;
    let prograss = document.getElementById(id + 'pro') as HTMLAudioElement;
    function ab(ev) {
      prograss.style.width = 0 + 'px';
      ev.stopPropagation();
    }
    function aa(e) {
      a = (player.currentTime / player.duration) * 100;
      prograss.style.width = a + '%';
      e.stopPropagation();
    }
    player.addEventListener('ended', ab.bind(this), false);
    player.addEventListener('timeupdate', aa.bind(this), false);

    if (player.paused) {
      player.play();
    } else {
      player.pause();
    }
  }

  async inFavorite() {
    if (!this.item) {
      return false;
    }

    const uid = '' + AppConfig.getUid();
    const db = getFirestore(firebaseApp);
    const dataDoc = await getDoc(doc(db, 'myFavorites', uid));

    let ditem = dataDoc.data();
    if (!ditem) {
      ditem = {};
    }
    const dataItems = ditem['items'] ? ditem['items'] : {};
    let arr: any[] = dataItems[this.item.Topic]
      ? dataItems[this.item.Topic]
      : [];

    return arr.includes(this.item.id);
  }

  async onFavoriteAdd(del = false) {
    if (!this.item) {
      return;
    }

    this.loadingWin = await this.loadingCtrl.create({
      message: 'save data ...',
      showBackdrop: true,
      duration: 120000,
    });
    this.loadingWin.present();

    const uid = '' + AppConfig.getUid();
    const db = getFirestore(firebaseApp);
    const dataDoc = await getDoc(doc(db, 'myFavorites', uid));

    let ditem = dataDoc.data();
    if (!ditem) {
      ditem = {};
    }
    const dataItems = ditem['items'] ? ditem['items'] : {};
    let arr: any[] = dataItems[this.item.Topic]
      ? dataItems[this.item.Topic]
      : [];

    if (del) {
      arr = arr.filter((v) => v != this.item.id);
    } else {
      if (!arr.includes(this.item.id)) {
        arr.push(this.item.id);
      }
    }

    dataItems[this.item.Topic] = arr;
    setDoc(doc(db, 'myFavorites', uid), {
      uid: uid,
      items: dataItems,
    });

    this.inFavoriteStatus = !del;
    this.loadingWin.dismiss();
  }
}
